import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const databaseUrl = process.env["DATABASE_URL"];

if (!databaseUrl) {
  // Log a clear warning but do NOT throw — the server must still start so
  // Railway's healthcheck at /api/healthz can pass.  Individual route handlers
  // already wrap DB calls in try/catch and return HTTP 500 on failure, so
  // missing DATABASE_URL degrades gracefully instead of crashing the process.
  console.warn(
    "[db] WARNING: DATABASE_URL is not set. Database operations will fail at runtime. " +
      "Add a PostgreSQL database to your Railway project and link it to this service.",
  );
}

// Pool is always created so TypeScript types remain clean.
// When DATABASE_URL is absent the placeholder connection string is used;
// any query attempt will fail and the route's try/catch will return HTTP 500.
export const pool = new Pool({
  connectionString: databaseUrl ?? "postgresql://localhost/unconfigured",
});

export const db = drizzle(pool, { schema });

export * from "./schema";
