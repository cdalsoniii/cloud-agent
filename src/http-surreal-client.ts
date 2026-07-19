import dotenv from "dotenv";
dotenv.config();

const SURREALDB_URL = process.env.SURREALDB_URL || "http://localhost:8000";
const SURREALDB_USER = process.env.SURREALDB_USER || "root";
const SURREALDB_PASS = process.env.SURREALDB_PASS || "root";
const SURREALDB_NS = process.env.SURREALDB_NS || "main";
const SURREALDB_DB = process.env.SURREALDB_DB || "main";

const SURREALDB_AUTH = Buffer.from(`${SURREALDB_USER}:${SURREALDB_PASS}`).toString("base64");

export async function surrealQuery(sql: string): Promise<any> {
  try {
    const fullQuery = `USE NS ${SURREALDB_NS} DB ${SURREALDB_DB}; ${sql}`;
    
    const response = await fetch(`${SURREALDB_URL}/sql`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "Authorization": `Basic ${SURREALDB_AUTH}`,
        "Accept": "application/json",
      },
      body: fullQuery,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    
    if (Array.isArray(result) && result.length > 1) {
      return result.slice(1);
    }
    
    return result;
  } catch (error) {
    console.error("❌ SurrealDB query failed:", error);
    throw error;
  }
}
