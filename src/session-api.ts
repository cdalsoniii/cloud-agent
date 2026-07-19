import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { URL } from "url";
import dotenv from "dotenv";

dotenv.config();

const SURREALDB_URL = process.env.SURREALDB_URL || "http://localhost:8000";
const SURREALDB_USER = process.env.SURREALDB_USER || "root";
const SURREALDB_PASS = process.env.SURREALDB_PASS || "root";
const SURREALDB_NS = process.env.SURREALDB_NS || "main";
const SURREALDB_DB = process.env.SURREALDB_DB || "main";
const PORT = parseInt(process.env.SESSION_API_PORT || "3001", 10);

async function surrealQuery(sql: string): Promise<any> {
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
  return results;
}

function jsonResponse(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method || "GET";

  try {
    if (path === "/health" && method === "GET") {
      const dbCheck = await surrealQuery("SELECT 1 AS one FROM 1");
      jsonResponse(res, 200, { status: "ok", db: dbCheck[0]?.status === "OK" ? "connected" : "error" });
      return;
    }

    if (path === "/sessions" && method === "GET") {
      const limit = parseInt(url.searchParams.get("limit") || "50", 10);
      const offset = parseInt(url.searchParams.get("offset") || "0", 10);
      const statusFilter = url.searchParams.get("status");
      const passFilter = url.searchParams.get("pass");

      let whereClause = "";
      const conditions: string[] = [];
      if (statusFilter) conditions.push(`status = '${statusFilter}'`);
      if (passFilter !== null) conditions.push(`pass = ${passFilter === "true"}`);
      if (conditions.length > 0) whereClause = `WHERE ${conditions.join(" AND ")}`;

      const results = await surrealQuery(`SELECT * FROM opencode_sessions ${whereClause} ORDER BY created DESC LIMIT ${limit} START ${offset}`);
      const records = results[0]?.result || [];
      jsonResponse(res, 200, { sessions: records, count: records.length });
      return;
    }

    if (path === "/sessions/stats" && method === "GET") {
      const [totalResult, statusResult, passResult, recentResult] = await Promise.all([
        surrealQuery("SELECT count() as total FROM opencode_sessions GROUP ALL"),
        surrealQuery("SELECT status, count() as count FROM opencode_sessions GROUP BY status"),
        surrealQuery("SELECT pass, count() as count FROM opencode_sessions GROUP BY pass"),
        surrealQuery("SELECT * FROM opencode_sessions ORDER BY created DESC LIMIT 5"),
      ]);

      const total = totalResult[0]?.result?.[0]?.total || 0;
      const byStatus = (statusResult[0]?.result || []).reduce((acc: Record<string, number>, r: any) => {
        acc[r.status || "unknown"] = r.count;
        return acc;
      }, {});
      const byPass = (passResult[0]?.result || []).reduce((acc: Record<string, number>, r: any) => {
        const key = r.pass === true ? "pass" : r.pass === false ? "fail" : "unknown";
        acc[key] = r.count;
        return acc;
      }, {});
      const recent = recentResult[0]?.result || [];

      jsonResponse(res, 200, {
        total,
        byStatus,
        byPass,
        recentSessions: recent,
      });
      return;
    }

    if (path === "/sessions/search" && method === "GET") {
      const q = url.searchParams.get("q") || "";
      const limit = parseInt(url.searchParams.get("limit") || "20", 10);
      if (!q) {
        jsonResponse(res, 400, { error: "Query parameter 'q' required" });
        return;
      }

      const results = await surrealQuery(`SELECT * FROM opencode_sessions WHERE title CONTAINS '${q.replace(/'/g, "\\'")}' LIMIT ${limit}`);
      const records = results[0]?.result || [];
      jsonResponse(res, 200, { sessions: records, count: records.length });
      return;
    }

    if (path.startsWith("/sessions/") && method === "GET") {
      const id = path.slice("/sessions/".length);
      if (!id) {
        jsonResponse(res, 400, { error: "Session ID required" });
        return;
      }

      const results = await surrealQuery(`SELECT * FROM opencode_sessions WHERE id = opencode_sessions:${id.replace(/'/g, "\\'")}`);
      const record = results[0]?.result?.[0];
      if (!record) {
        jsonResponse(res, 404, { error: "Session not found" });
        return;
      }
      jsonResponse(res, 200, record);
      return;
    }

    jsonResponse(res, 404, { error: "Not found" });
  } catch (error) {
    console.error("API error:", error);
    jsonResponse(res, 500, { error: error instanceof Error ? error.message : "Internal server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Session API server running on http://localhost:${PORT}`);
  console.log(`Endpoints:`);
  console.log(`  GET /health`);
  console.log(`  GET /sessions?limit=50&offset=0&status=&pass=`);
  console.log(`  GET /sessions/:id`);
  console.log(`  GET /sessions/stats`);
  console.log(`  GET /sessions/search?q=query`);
});
