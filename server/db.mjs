/**
 * The gateway's Postgres pool, from DATABASE_URL. Unset (the existing Railway service, a plain
 * `npm start`): there is no database, `db()` is null and the health check says "off" rather than "down".
 * The pool is made on first use, so a server with no database never loads a connection.
 *
 * Every connection has a statement timeout, so one slow query can't hold a request (or the pool) for long.
 */
import pg from "pg";

/** Pool and timeout settings, overridable from the environment. */
export function dbSettings(env = process.env) {
  const n = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return {
    connectionString: (env.DATABASE_URL ?? "").trim(),
    max: n(env.DB_POOL_MAX, 10),
    idleTimeoutMillis: n(env.DB_IDLE_TIMEOUT_MS, 30_000),
    connectionTimeoutMillis: n(env.DB_CONNECT_TIMEOUT_MS, 5_000),
    statement_timeout: n(env.DB_STATEMENT_TIMEOUT_MS, 10_000),
    query_timeout: n(env.DB_QUERY_TIMEOUT_MS, 15_000),
    application_name: "praxis-gateway",
  };
}

let pool = null;

/** The shared pool, or null when DATABASE_URL isn't set. */
export function db() {
  if (pool) return pool;
  const settings = dbSettings();
  if (!settings.connectionString) return null;
  pool = new pg.Pool(settings);
  // An idle client that loses its connection emits here; without a listener the process would crash.
  pool.on("error", (err) => console.error(JSON.stringify({ type: "db_error", at: new Date().toISOString(), code: err?.code ?? "unknown" })));
  return pool;
}

/** Closes the pool (tests, shutdown). */
export async function closeDb() {
  const p = pool;
  pool = null;
  await p?.end();
}
