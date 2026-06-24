import pg from "pg";

const { Pool } = pg;

// Reuse a single pool across hot-reloads in dev and across invocations in prod.
// Stashing it on globalThis prevents Next.js from opening a new pool on every
// module re-evaluation.
const globalForPg = globalThis;

const connectionString =
  process.env.DATABASE_URL ||
  "postgres://elango:elango_secret@localhost:5432/travelbot";

export const pool =
  globalForPg.__elangoPgPool ??
  new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

if (!globalForPg.__elangoPgPool) {
  globalForPg.__elangoPgPool = pool;
  pool.on("error", (err) => {
    // A backend connection died while idle; log it rather than crashing.
    console.error(`[db] Idle client error: ${err?.message}`);
  });
}

/**
 * Run a parameterised SQL query.
 * @param {string} text - SQL with $1, $2 … placeholders.
 * @param {Array<any>} [params] - Bound parameters.
 * @returns {Promise<import('pg').QueryResult>}
 */
export function query(text, params = []) {
  return pool.query(text, params);
}
