/**
 * SurrealDB GraphQL client (native SurrealDB v3 GraphQL endpoint).
 *
 * Talks to `http://127.0.0.1:8000/graphql` with ns/db headers, returning typed
 * GraphQL responses. Used by the Lean↔GraphQL validation loop to continuously
 * verify complex data relationships against whatever tables Surreal exposes
 * (person, sandbox_log, and the research-report ontology tables once Task 3
 * mirrors them into the gateway's test/test namespace).
 */

export interface GraphQLRequestOptions {
  query: string;
  variables?: Record<string, unknown>;
  ns?: string;
  db?: string;
}

export interface GraphQLResult<T = unknown> {
  data?: T;
  errors?: Array<{ message: string; locations?: unknown[]; path?: unknown[] }>;
}

const DEFAULT_URL = process.env.SURREAL_GRAPHQL_URL ?? 'http://127.0.0.1:8000/graphql';
const DEFAULT_USER = process.env.SURREAL_USER ?? 'root';
const DEFAULT_PASS = process.env.SURREAL_PASS ?? 'root';
const DEFAULT_NS = process.env.SURREAL_NS ?? 'test';
const DEFAULT_DB = process.env.SURREAL_DB ?? 'test';

/**
 * Execute a GraphQL query against the SurrealDB GraphQL endpoint.
 * Throws on HTTP/transport errors; returns the parsed payload (errors are
 * surfaced in the return value so callers can report on them).
 */
export async function graphqlRequest<T = unknown>(
  opts: GraphQLRequestOptions,
): Promise<GraphQLResult<T>> {
  const url = new URL(DEFAULT_URL);
  const auth = Buffer.from(`${DEFAULT_USER}:${DEFAULT_PASS}`).toString('base64');

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
      'surreal-ns': opts.ns ?? DEFAULT_NS,
      'surreal-db': opts.db ?? DEFAULT_DB,
    },
    body: JSON.stringify({ query: opts.query, variables: opts.variables ?? {} }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GraphQL HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  return (await response.json()) as GraphQLResult<T>;
}

/**
 * Introspect the GraphQL endpoint's Query root fields so validation can
 * discover tables generically instead of hard-coding them.
 */
export async function discoverQueryFields(ns?: string, db?: string): Promise<string[]> {
  const result = await graphqlRequest<{
    __schema?: { queryType?: { fields?: Array<{ name: string }> } };
  }>(
    {
      query: `{ __schema { queryType { fields { name } } } }`,
      ns,
      db,
    },
  );
  return (result.data?.__schema?.queryType?.fields ?? []).map((f) => f.name);
}

/** Whether a given table name is exposed as a GraphQL root (list/single forms). */
export function tableIsExposed(table: string, queryFields: string[]): boolean {
  // Surreal v3 camelCases single/multi-word tables: sandbox_log -> sandboxLogs/sandboxLog
  const camel = table
    .replace(/^__/, '')
    .replace(/(?:^|_)(.)/g, (_m, c: string) => c.toUpperCase())
    .replace(/^./, (c: string) => c.toLowerCase());
  const list = camel.endsWith('s') ? camel : `${camel}s`;
  const singular = camel;
  return (
    queryFields.includes(table) ||
    queryFields.includes(list) ||
    queryFields.includes(singular) ||
    queryFields.some((f) => f.toLowerCase() === table.toLowerCase())
  );
}
