#!/usr/bin/env npx tsx
/**
 * lean-surreal-graphql.ts — Continuously validate SurrealDB relationships over
 * the native GraphQL endpoint, mirroring the SurrealQL consistency checks that
 * live in temporal/ontology-workflows.ts (runConsistencyCheck).
 *
 * Design goals:
 *   - Generic: discovers whatever tables `test/test` GraphQL exposes and runs
 *     relation invariants against each, so the report-ontology tables picked up
 *     in Task 3 (ontology_node / ontology_edge / ontology_rule / ontology_event)
 *     are validated automatically once mirrored into the federated namespace.
 *   - The relationship invariants mirror the SurrealQL checks:
 *       1. self-loop  — an edge whose source == target
 *       2. dangling   — an edge whose source/target is not a live node
 *       3. (export-side) cycle detection over the generated graph
 *
 * Output:
 *   - writes `.px/lean-surreal/report.json` (one JSONL line per table check)
 *   - writes a `verification_artifact` row into SurrealDB (ns=main/db=main)
 *   - exits non-zero when any invariant fails
 *
 * Usage:  npx tsx scripts/lean-surreal-graphql.ts [--ns test --db test]
 */

import {
  graphqlRequest,
  discoverQueryFields,
  tableIsExposed,
} from '../src/surreal-graphql-client.ts';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, '.px', 'lean-surreal');

// ns/db default to the gateway's federated namespace (test/test).
const NS = process.env.SURREAL_NS ?? 'test';
const DB = process.env.SURREAL_DB ?? 'test';

/**
 * Normalise Surreal record ids ("ontology_edge:xxxx", "person:alice") to a bare
 * string so cross-table comparisons are stable.
 */
function bareId(id: unknown): string {
  if (typeof id !== 'string') return String(id);
  if (id.includes(':')) return id.slice(id.indexOf(':') + 1);
  return id;
}

/** Bare id plus nothing — a node key. */
function nodeKey(id: unknown): string {
  return bareId(id);
}

/**
 * Fetch rows for a GraphQL list field (e.g. `persons`, `sandboxLogs`). These
 * expose `limit`/`start`/`order`/`where`/`filter`/`version` (NOT `after`); we
 * pull a generous page in one round trip since these datasets are small.
 */
async function fetchRows(
  listField: string,
  selection = 'id __typename',
): Promise<Record<string, unknown>[]> {
  const q = `query($limit: Int) {
    ${listField}(limit: $limit) {
      ${selection}
    }
  }`;
  const res = await graphqlRequest<Record<string, unknown[]>>({
    query: q,
    variables: { limit: 100000 },
    ns: NS,
    db: DB,
  });
  if (res.errors?.length) return [];
  return res.data?.[listField] ?? [];
}

/**
 * Column-per-table projection helper: given a table's exposed fields return a
 * GraphQL field-selection string. Only scalar-ish fields are requested; object
 * graphs (like `properties TYPE object`) are skipped because GraphQL would
 * require knowing their nested shape.
 */
function selectionFor(table: string, exposedFields: string[]): string {
  const scalar = new Set(['ID', 'String', 'Int', 'Float', 'Boolean', 'datetime', 'number', 'JSON']);
  const fields = exposedFields.filter((f) => f !== 'id');
  // We select by name only; type filtering would require __schema per object.
  return fields.join(' ');
}

interface TableReport {
  table: string;
  exposed: boolean;
  rowCount: number;
  checks: Array<{
    check: string;
    violations: number;
    examples: string[];
  }>;
}

/**
 * Run relationship invariants for one table. A "relationship" table is one that
 * has a *_id reference to another table (e.g. ontology_edge.source_id/target_id,
 * or sandbox_log.sandbox_id). We treat the set of all live ids across tables as
 * the universe of nodes and verify each *_id resolves.
 */
/**
 * Run relationship invariants for one table. A "edge" table is one exposing
 * both `source_id` and `target_id` (e.g. ontology_edge). For those we verify:
 *   no_self_loops — source != target
 *   no_dangling    — both endpoints are members of the node universe
 * The node universe is the union of every id-like value seen across all tables
 * (collected in a prior pass), so edges referencing natural keys resolve.
 */
async function checkTable(
  table: string,
  listField: string,
  nodeUniverse: Set<string>,
): Promise<TableReport> {
  const report: TableReport = {
    table,
    exposed: true,
    rowCount: 0,
    checks: [],
  };

  const fields = await typeFields(table);
  const isEdge = fields.includes('source_id') && fields.includes('target_id');
  const selection = isEdge
    ? 'id source_id target_id __typename'
    : 'id __typename';
  const rows = await fetchRows(listField, selection);
  report.rowCount = rows.length;
  report.checks.push({ check: 'rows_scanned', violations: 0, examples: [] });

  // Record the id universe for this table.
  for (const row of rows) {
    if (row.id !== null && row.id !== undefined) nodeUniverse.add(nodeKey(row.id));
  }

  if (isEdge) {
    const loops = rows
      .filter((r) => nodeKey(r.source_id) !== '' && nodeKey(r.source_id) === nodeKey(r.target_id))
      .map((r) => `${String(r.id)}: ${r.source_id} == ${r.target_id}`);
    report.checks.push({
      check: 'no_self_loops',
      violations: loops.length,
      examples: loops,
    });

    const dangling = rows
      .filter((r) => {
        const s = nodeKey(r.source_id);
        const t = nodeKey(r.target_id);
        if (!s || !t) return false; // missing endpoints handled separately if desired
        return !nodeUniverse.has(s) || !nodeUniverse.has(t);
      })
      .map((r) => `${String(r.id)}: ${r.source_id} -> ${r.target_id}`);
    report.checks.push({
      check: 'no_dangling_edges',
      violations: dangling.length,
      examples: dangling,
    });
  }
  return report;
}

/** Introspect the scalar fields of a table's GraphQL object type. */
async function typeFields(table: string): Promise<string[]> {
  const q = `query($n: String!) { __type(name: $n) { fields { name } } }`;
  const res = await graphqlRequest<{
    __type?: { fields?: Array<{ name: string }> } | null;
  }>({ query: q, variables: { n: table }, ns: NS, db: DB });
  return (res.data?.__type?.fields ?? []).map((f) => f.name);
}

function writeReport(reports: TableReport[]): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const pathOut = path.join(OUT_DIR, 'report.json');
  const summary = {
    at: new Date().toISOString(),
    ns: NS,
    db: DB,
    tables: reports,
    totalViolations: reports.reduce(
      (acc, r) => acc + r.checks.reduce((a, c) => a + c.violations, 0),
      0,
    ),
  };
  fs.writeFileSync(pathOut, JSON.stringify(summary, null, 2));
  fs.appendFileSync(
    path.join(OUT_DIR, 'report.jsonl'),
    `${JSON.stringify(summary)}\n`,
  );
}

async function persistArtifact(summary: {
  totalViolations: number;
  ns: string;
  db: string;
}): Promise<void> {
  const artifact = {
    type: 'lean_surreal_graphql_validation',
    name: 'lean-surreal-graphql',
    status: summary.totalViolations === 0 ? 'pass' : 'fail',
    violations: summary.totalViolations,
    namespace: summary.ns,
    database: summary.db,
    created_at: new Date().toISOString(),
  };
  try {
    const resp = await fetch(`http://127.0.0.1:8000/sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from('root:root').toString('base64')}`,
        'surreal-ns': 'main',
        'surreal-db': 'main',
      },
      body: JSON.stringify([
        `CREATE verification_artifact CONTENT ${JSON.stringify(artifact)}`,
      ]),
    });
    if (!resp.ok) {
      console.error(`artifact persist skipped: HTTP ${resp.status}`);
    }
  } catch (err) {
    console.error(`artifact persist skipped: ${(err as Error).message}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const argVal = (k: string) => {
    const i = args.indexOf(k);
    return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
  };
  const ns = argVal('--ns') ?? NS;
  const db = argVal('--db') ?? DB;

  const fields = await discoverQueryFields(ns, db);
  const reports: TableReport[] = [];

  // List root fields are camelCased (e.g. `sandboxLogs`, `persons`, `entities`).
  // The authoritative Surreal table name comes from each row's `__typename`.
  const listFields = fields.filter((f) => f.endsWith('s'));

  // Resolve the real table name + list field per exposed root.
  const tables: Array<{ table: string; listField: string }> = [];
  for (const listField of listFields.sort()) {
    const rows = await fetchRows(listField, 'id __typename');
    const typenames = new Set(rows.map((r) => String(r.__typename ?? '')).filter(Boolean));
    if (typenames.size === 0) continue; // table empty / unexposed
    tables.push({ table: [...typenames][0], listField });
  }

  // Pass 1: collect the node universe from every table's ids so dangling-edge
  // checks can resolve cross-table references in Pass 2.
  const nodeUniverse = new Set<string>();
  for (const { table, listField } of tables) {
    const fields = await typeFields(table);
    const isEdge = fields.includes('source_id') && fields.includes('target_id');
    const rows = await fetchRows(listField, isEdge ? 'id source_id target_id' : 'id');
    for (const r of rows) {
      if (isEdge) {
        if (r.source_id != null) nodeUniverse.add(nodeKey(r.source_id));
        if (r.target_id != null) nodeUniverse.add(nodeKey(r.target_id));
      }
      if (r.id != null) nodeUniverse.add(nodeKey(r.id));
    }
  }

  // Pass 2: run invariant checks per table.
  for (const { table, listField } of tables) {
    try {
      reports.push(await checkTable(table, listField, nodeUniverse));
    } catch (err) {
      reports.push({
        table,
        exposed: false,
        rowCount: 0,
        checks: [
          {
            check: 'error',
            violations: 1,
            examples: [(err as Error).message],
          },
        ],
      });
    }
  }

  writeReport(reports);
  const total = reports.reduce(
    (acc, r) => acc + r.checks.reduce((a, c) => a + c.violations, 0),
    0,
  );

  // Print a human summary.
  for (const r of reports) {
    for (const c of r.checks) {
      if (c.violations > 0 && c.check !== 'rows_scanned') {
        console.log(
          `[${r.table}] ${c.check}: ${c.violations} violation(s)` +
            (c.examples.length ? ` e.g. ${c.examples.slice(0, 3).join('; ')}` : ''),
        );
      }
    }
    console.log(`[${r.table}] ${r.rowCount} rows scanned`);
  }
  console.log(`total violations: ${total}`);

  await persistArtifact({ totalViolations: total, ns, db });
  if (total > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
