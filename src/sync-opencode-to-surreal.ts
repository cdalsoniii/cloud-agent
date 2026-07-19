import { readFile } from "fs/promises";
import dotenv from "dotenv";

dotenv.config();

const SURREALDB_URL = process.env.SURREALDB_URL || "http://localhost:8000";
const SURREALDB_USER = process.env.SURREALDB_USER || "root";
const SURREALDB_PASS = process.env.SURREALDB_PASS || "root";
const SURREALDB_NS = process.env.SURREALDB_NS || "main";
const SURREALDB_DB = process.env.SURREALDB_DB || "main";

async function query(sql: string): Promise<any> {
  const response = await fetch(new URL("/sql", SURREALDB_URL).toString(), {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "text/plain",
      "surreal-ns": SURREALDB_NS,
      "surreal-db": SURREALDB_DB,
      "Authorization": "Basic " + Buffer.from(`${SURREALDB_USER}:${SURREALDB_PASS}`).toString("base64"),
    },
    body: sql,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  const results = await response.json();
  const errors = results.filter((r: any) => r.status === "ERR");
  if (errors.length > 0) {
    throw new Error(`Query errors: ${JSON.stringify(errors)}`);
  }

  return results;
}

interface OpencodeSessionRaw {
  id: string;
  title: string;
  updated: number; // unix ms
  created: number; // unix ms
  projectId: string;
  directory: string;
}

function isJsonTitle(title: string): boolean {
  return title.trim().startsWith("{") && title.trim().endsWith("}");
}

async function main() {
  const jsonPath = "./opencode-sessions.json";
  let rawData: string;
  try {
    rawData = await readFile(jsonPath, { encoding: "utf-8" });
  } catch (e) {
    console.error("Failed to read opencode-sessions.json", e);
    process.exit(1);
  }

  let sessions: OpencodeSessionRaw[];
  try {
    sessions = JSON.parse(rawData);
  } catch (e) {
    console.error("Invalid JSON in opencode-sessions.json", e);
    process.exit(1);
  }

  let synced = 0;
  let failed = 0;

  for (const s of sessions) {
    let parsed: any = null;
    let titleClean = s.title;
    let pass: boolean | null = null;
    let reasons: string[] = [];

    if (isJsonTitle(s.title)) {
      try {
        parsed = JSON.parse(s.title);
        if (typeof parsed.pass === "boolean") {
          pass = parsed.pass;
        }
        if (Array.isArray(parsed.reasons)) {
          reasons = parsed.reasons.map(String);
        }
        titleClean = "";
      } catch {
        // fallback to original title string
      }
    }

    const sql = `
      CREATE opencode_sessions CONTENT {
        id: '${s.id}',
        title: '${titleClean.replace(/'/g, "\\'")}',
        status: 'completed',
        pass: ${pass === null ? 'NONE' : pass},
        reasons: ${JSON.stringify(reasons)},
        cost: 0,
        tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
        duration: 0s,
        created: <datetime>'${new Date(s.created).toISOString()}',
        updated: <datetime>'${new Date(s.updated).toISOString()}',
        project_id: '${s.projectId}',
        directory: '${s.directory.replace(/'/g, "\\'")}',
        agent: 'opencode-sync',
        model: 'unknown',
        summary: { additions: 0, deletions: 0, files: [] }
      }
    `;

    try {
      await query(sql);
      synced++;
      if (synced % 50 === 0) {
        console.log(`Synced ${synced} records`);
      }
    } catch (e) {
      failed++;
      console.error(`Failed to upsert session ${s.id}:`, e instanceof Error ? e.message : String(e));
    }
  }

  console.log(`\nFinished syncing. Total: ${sessions.length}, synced: ${synced}, failed: ${failed}`);
}

main();
