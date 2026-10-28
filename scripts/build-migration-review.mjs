// Produce reviewable SQL for missing migrations from a known version. No database connection.
// Locks existing application tables briefly, compares data hashes, then verifies the final schema.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const output = process.argv[2];
if (!output || !path.isAbsolute(output)) throw new Error("Usage: node scripts/build-migration-review.mjs /absolute/output-prefix [--from VERSION]");
const directory = new URL("../supabase/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("release-manifest.json", directory), "utf8"));
const latest = manifest.migrations.at(-1);
if (!latest || manifest.migrations.length < 2) throw new Error("Requires an incremental migration");
const fromFlag = process.argv.indexOf("--from");
const previousVersion = fromFlag < 0 ? manifest.migrations.at(-2).file.slice(0, 14) : process.argv[fromFlag + 1];
const fromIndex = manifest.migrations.findIndex(item => item.file.slice(0, 14) === previousVersion);
if (fromIndex < 0 || fromIndex >= manifest.migrations.length - 1) throw new Error("--from must name an earlier version in the release manifest");
const missing = manifest.migrations.slice(fromIndex + 1);
const sources = [];
for (const item of missing) {
  const sql = await readFile(new URL(`migrations/${item.file}`, directory), "utf8");
  if (createHash("sha256").update(sql).digest("hex") !== item.sha256) throw new Error("Migration differs from release manifest");
  sources.push(`-- Source: ${item.file}; SHA-256 ${item.sha256}\n${sql.replace(/^begin;\s*$/m, "").replace(/^commit;\s*$/m, "")}`);
}
const verify = await readFile(new URL("verify.sql", directory), "utf8");
if (createHash("sha256").update(verify).digest("hex") !== manifest.artifacts["verify.sql"]) throw new Error("Verify differs from release manifest");
const header = `-- Generated review from ${previousVersion} to ${manifest.schema_version}; ${missing.length} missing migrations.
-- Existing application data stays in the database; only counts and aggregate hashes are returned.
-- Test-project review first. This is not a backup or a CLI migration-history repair.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
do $precondition$ begin
  if (select version from public.app_schema_version where id=1) is distinct from '${previousVersion}' then
    raise exception 'Unexpected starting schema version';
  end if;
end $precondition$;
create temporary table migration_data_before(name text primary key, projection text not null, row_count bigint, row_hash text) on commit drop;
do $snapshot$
declare r record; n bigint; h text; cols text;
begin
  for r in select c.relname from pg_class c join pg_namespace s on s.oid=c.relnamespace
    where s.nspname='public' and c.relkind in ('r','p') and c.relname<>'app_schema_version'
      and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e')
    order by c.relname
  loop
    execute format('lock table public.%I in share mode',r.relname);
    select string_agg(format('%I',a.attname),',' order by a.attnum) into cols
      from pg_attribute a where a.attrelid=format('public.%I',r.relname)::regclass and a.attnum>0 and not a.attisdropped;
    execute format($rows$select count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) from (select %s from public.%I) t$rows$,cols,r.relname) into n,h;
    insert into migration_data_before values(r.relname,cols,n,h);
  end loop;
end $snapshot$;
`;
const checkData = `
do $preservation$
declare r record; n bigint; h text;
begin
  for r in select * from migration_data_before loop
    execute format($rows$select count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) from (select %s from public.%I) t$rows$,r.projection,r.name) into n,h;
    if n is distinct from r.row_count or h is distinct from r.row_hash then
      raise exception 'Migration changed data in %',r.name;
    end if;
  end loop;
end $preservation$;
create temporary table migration_verify on commit drop as
${verify.trim().replace(/;$/, "")};
do $verified$ begin
  if exists(select 1 from migration_verify where passed is distinct from true) then
    raise exception 'Migration verify failed';
  end if;
end $verified$;
select (select version from public.app_schema_version where id=1) as schema_version,
  (select count(*) from migration_data_before) as preserved_tables,
  (select count(*) from migration_verify where passed) as passed_checks,
  (select md5(string_agg(name||':'||row_count||':'||row_hash,',' order by name)) from migration_data_before) as data_digest;
`;
const body = header + sources.join("\n") + checkData;
for (const mode of ["rollback", "commit"]) {
  const file = `${output}-${mode}.sql`;
  await writeFile(file, body + `\n${mode};\n`);
  console.log(`${mode}: ${file}`);
}
