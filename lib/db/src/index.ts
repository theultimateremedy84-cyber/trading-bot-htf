import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// The pool connects lazily – no TCP connection is made until the first query.
// Deferring the DATABASE_URL check to query-time (rather than module load time)
// lets the process start and serve the /api/healthz endpoint even before the
// database environment variable has been injected, which is important for
// Railway's startup health-check sequence.
//
// If DATABASE_URL is missing, the first route handler that touches the DB will
// throw and return a 500 – all other routes (including healthz) keep working.
export const pool = new Pool({
  connectionString: process.env["DATABASE_URL"] ?? "",
});

export const db = drizzle(pool, { schema });

export * from "./schema";
