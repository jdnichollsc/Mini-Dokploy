import { createClient } from "@libsql/client";
import { env } from "@mini-dokploy/env/db";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Programmatic migrator. Called from the migrator service entrypoint and from
// `pnpm db:migrate` in dev.
export async function runMigrations(): Promise<void> {
  const client = createClient({ url: env.DATABASE_URL });
  const db = drizzle(client);

  // Resolve migrations folder relative to this file so it works from anywhere
  // (dev: source path; prod: copied to dist/ next to the .js file).
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = resolve(here, "./migrations");

  console.log(`→ Running migrations from ${migrationsFolder} against ${env.DATABASE_URL}`);
  await migrate(db, { migrationsFolder });
  console.log("✓ Migrations applied");
  client.close();
}

// Allow `node packages/db/src/migrate.ts` invocation.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runMigrations().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
