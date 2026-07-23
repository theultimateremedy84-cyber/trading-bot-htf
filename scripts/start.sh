#!/bin/sh
# Railway startup script
# 1. Pushes the Drizzle schema to the database (idempotent – safe to re-run)
# 2. Starts the API server
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "WARNING: DATABASE_URL is not set. The server will start but all database operations will fail."
else
  echo "Running database schema push..."
  pnpm --filter @workspace/db run push --force 2>&1 || {
    echo "WARNING: Schema push failed. The server will still start."
  }
  echo "Schema push complete."
fi

echo "Starting API server on port $PORT..."
exec node --enable-source-maps /app/artifacts/api-server/dist/index.mjs
