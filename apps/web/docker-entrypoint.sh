#!/usr/bin/env sh
set -e

# Apply pending Drizzle migrations against the shared SQLite file.
# The file lives on the dokploy-data Swarm volume so the worker sees the
# migrated schema too.
node /app/packages/db/src/migrate.js || node -e "
  const { createClient } = require('@libsql/client');
  const { drizzle } = require('drizzle-orm/libsql');
  const { migrate } = require('drizzle-orm/libsql/migrator');
  (async () => {
    const client = createClient({ url: process.env.DATABASE_URL });
    await migrate(drizzle(client), { migrationsFolder: '/app/packages/db/src/migrations' });
    client.close();
  })();
"

# Hand off to Next standalone server.
exec node /app/apps/web/server.js
