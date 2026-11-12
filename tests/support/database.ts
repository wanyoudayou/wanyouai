import { readFile, readdir } from "node:fs/promises";
import type { PGlite } from "@electric-sql/pglite";

/** Supabase's platform schemas are simulated; all application SQL is real. */
export async function installTestDatabase(db: PGlite, { fixtures = true, throughVersion }: { fixtures?: boolean; throughVersion?: string } = {}) {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users (
      id uuid primary key, email text, email_confirmed_at timestamptz,
      aud text, role text, raw_user_meta_data jsonb, raw_app_meta_data jsonb,
      created_at timestamptz not null default now()
    );
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid
    $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to public;
  `);
  const directory = new URL("../../supabase/", import.meta.url);
  const migrations = (await readdir(new URL("migrations/", directory))).filter((file) => /^\d{14}_[\w-]+\.sql$/.test(file)).sort();
  if (!migrations.length) throw new Error("No application migrations found");
  for (const file of migrations) {
    if (throughVersion && file.slice(0, 14) > throughVersion) break;
    await db.exec(await readFile(new URL(`migrations/${file}`, directory), "utf8"));
  }
  await db.exec(await readFile(new URL("demo.sql", directory), "utf8"));
  if (fixtures) await db.exec(await readFile(new URL("tests/rls-fixtures.sql", directory), "utf8"));
  await db.exec("reset role; reset request.jwt.claims");
}
