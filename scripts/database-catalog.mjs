const roles = "(a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon','authenticated','service_role'))";
const roleName = "case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end";

/** Extract application objects, excluding extension-owned functions. No user rows. */
export async function readApplicationCatalog(db) {
  const query = async (sql) => (await db.query(sql)).rows;
  const unsupported = await query(`select n.nspname schema_name,c.relname name,c.relkind::text kind from pg_class c
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
    and (c.relkind in ('m','f','p') or (c.relkind='r' and (c.relpersistence<>'p' or c.relreplident<>'d' or c.relispartition or c.relhassubclass)))
    union all select n.nspname,t.typname,t.typtype::text from pg_type t join pg_namespace n on n.oid=t.typnamespace
    where n.nspname='public' and t.typtype in ('e','d')
    and not exists(select 1 from pg_depend d where d.classid='pg_type'::regclass and d.objid=t.oid and d.deptype='e')
    union all select n.nspname,p.proname,'procedure' from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='p'
    union all select n.nspname,c.collname,'collation' from pg_collation c join pg_namespace n on n.oid=c.collnamespace
    where n.nspname='public'
    union all select n.nspname,n.nspname,'schema' from pg_namespace n
    where n.nspname not in ('public','auth','extensions','information_schema','ai_internal') and n.nspname not like 'pg_%'
    union all select n.nspname,c.relname,c.relkind::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='ai_internal'
    union all select n.nspname,t.typname,t.typtype::text from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='ai_internal'
    union all select n.nspname,p.proname,'procedure' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='ai_internal' and p.prokind<>'f'`);
  if (unsupported.length) throw new Error(`Unsupported schema objects: ${JSON.stringify(unsupported)}`);
  return {
    schemas: await query(`select nspname name from pg_namespace where nspname='ai_internal' order by nspname`),
    schemaGrants: await query(`select n.nspname name,${roleName} role,a.privilege_type privilege,a.is_grantable grantable
      from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
      where n.nspname='ai_internal' and ${roles} order by n.nspname,role,a.privilege_type`),
    tables: await query(`select c.relname name,c.relrowsecurity rls,c.relforcerowsecurity force_rls,
      jsonb_agg(jsonb_build_object('name',t.attname,'type',format_type(t.atttypid,t.atttypmod),
        'not_null',t.attnotnull,'identity',t.attidentity,'generated',t.attgenerated,
        'default',pg_get_expr(d.adbin,d.adrelid)) order by t.attnum) columns
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      join pg_attribute t on t.attrelid=c.oid and t.attnum>0 and not t.attisdropped
      left join pg_attrdef d on d.adrelid=c.oid and d.adnum=t.attnum
      where n.nspname='public' and c.relkind='r' group by c.oid order by c.relname`),
    sequences: await query(`select c.relname name,format_type(s.seqtypid,null) type,s.seqstart::text start,
      s.seqincrement::text increment,s.seqmax::text maximum,s.seqmin::text minimum,s.seqcache::text cache,s.seqcycle cycle,
      t.relname table_name,a.attname column_name from pg_sequence s join pg_class c on c.oid=s.seqrelid
      join pg_namespace n on n.oid=c.relnamespace
      left join pg_depend d on d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='i'
      left join pg_class t on t.oid=d.refobjid left join pg_attribute a on a.attrelid=t.oid and a.attnum=d.refobjsubid
      where n.nspname='public' order by c.relname`),
    constraints: await query(`select c.relname table_name,k.conname name,k.contype kind,pg_get_constraintdef(k.oid,true) definition
      from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and k.contype<>'n' order by case k.contype when 'p' then 0 when 'u' then 1 when 'c' then 2 else 3 end,c.relname,k.conname`),
    indexes: await query(`select c.relname name,pg_get_indexdef(i.indexrelid) definition
      from pg_index i join pg_class c on c.oid=i.indexrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and not exists(select 1 from pg_constraint k where k.conindid=i.indexrelid) order by c.relname`),
    functions: await query(`select p.proname name,format('%I.%I(%s)',n.nspname,p.proname,
      array_to_string(array(select format_type(t,null) from unnest(p.proargtypes::oid[]) t),', ')) signature,
      pg_get_functiondef(p.oid) definition
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','ai_internal') and p.prokind='f'
      and not (p.proname='rls_auto_enable' and p.prorettype='pg_catalog.event_trigger'::regtype)
      and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e') order by p.oid`),
    views: await query(`select c.relname name,pg_get_viewdef(c.oid,true) definition,c.reloptions options
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='v' order by c.relname`),
    triggers: await query(`select n.nspname schema_name,c.relname table_name,t.tgname name,t.tgenabled enabled,pg_get_triggerdef(t.oid,true) definition
      from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
      join pg_proc p on p.oid=t.tgfoid join pg_namespace f on f.oid=p.pronamespace
      where not t.tgisinternal and f.nspname in ('public','ai_internal') and n.nspname in ('public','auth') order by n.nspname,c.relname,t.tgname`),
    policies: await query(`select c.relname table_name,p.polname name,p.polcmd command,p.polpermissive permissive,
      array(select case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end from unnest(p.polroles) r order by r) roles,
      pg_get_expr(p.polqual,p.polrelid,true) using_expr,pg_get_expr(p.polwithcheck,p.polrelid,true) check_expr
      from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' order by c.relname,p.polname`),
    relationGrants: await query(`select c.relname name,c.relkind kind,${roleName} role,a.privilege_type privilege,a.is_grantable grantable
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 's'::"char" else 'r'::"char" end,c.relowner))) a
      where n.nspname='public' and c.relkind in ('r','v','S') and ${roles} order by c.relname,role,a.privilege_type`),
    columnGrants: await query(`select c.relname table_name,t.attname name,${roleName} role,a.privilege_type privilege,a.is_grantable grantable
      from pg_attribute t join pg_class c on c.oid=t.attrelid join pg_namespace n on n.oid=c.relnamespace
      cross join lateral aclexplode(t.attacl) a where n.nspname='public' and t.attnum>0 and not t.attisdropped and ${roles}
      order by c.relname,t.attname,role,a.privilege_type`),
    functionGrants: await query(`select format('%I.%I(%s)',n.nspname,p.proname,
      array_to_string(array(select format_type(t,null) from unnest(p.proargtypes::oid[]) t),', ')) signature,
      ${roleName} role,a.privilege_type privilege,a.is_grantable grantable
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where n.nspname in ('public','ai_internal') and p.prokind='f' and ${roles}
      and not (p.proname='rls_auto_enable' and p.prorettype='pg_catalog.event_trigger'::regtype)
      and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
      order by signature,role,a.privilege_type`),
  };
}

const quote = (name) => `"${name.replaceAll('"', '""')}"`;
const qualified = (name) => `public.${quote(name)}`;
const role = (name) => name === "PUBLIC" ? "PUBLIC" : quote(name);
const statement = (sql) => `${sql.trim().replace(/;$/, "")};`;

export function renderApplicationCatalog(catalog) {
  const sql = ["-- Generated final-state application schema. Do not edit by hand.",
    "-- Final schema without site configuration or demo rows. New installations use install.sql.",
    "begin;", "create schema if not exists extensions;", "create extension if not exists vector with schema extensions;",
    "grant usage on schema extensions to anon, authenticated, service_role;",
    "grant usage on schema public to anon, authenticated, service_role;"];
  for (const schema of catalog.schemas) sql.push(`create schema ${quote(schema.name)};`, `revoke all on schema ${quote(schema.name)} from public, anon, authenticated, service_role;`);
  for (const grant of catalog.schemaGrants) sql.push(`grant ${grant.privilege} on schema ${quote(grant.name)} to ${role(grant.role)}${grant.grantable ? " with grant option" : ""};`);
  for (const table of catalog.tables) {
    const columns = table.columns.map((column) => {
      if (column.generated) throw new Error(`Unsupported generated column: ${table.name}.${column.name}`);
      const identity = column.identity === "a" ? " generated always as identity" : column.identity === "d" ? " generated by default as identity" : "";
      return `  ${quote(column.name)} ${column.type}${identity}${column.not_null ? " not null" : ""}`;
    });
    sql.push(`create table ${qualified(table.name)} (\n${columns.join(",\n")}\n);`);
  }
  for (const sequence of catalog.sequences) {
    if (!sequence.table_name || !sequence.column_name) throw new Error(`Unsupported standalone sequence: ${sequence.name}`);
    sql.push(`alter sequence ${qualified(sequence.name)} as ${sequence.type} increment by ${sequence.increment} minvalue ${sequence.minimum} maxvalue ${sequence.maximum} start with ${sequence.start} cache ${sequence.cache} ${sequence.cycle ? "cycle" : "no cycle"};`);
  }
  // Like pg_dump, defer body resolution until relations/views and all functions
  // exist. Executable installation/permission regressions validate their bodies.
  sql.push("set local check_function_bodies=off;");
  for (const fn of catalog.functions) sql.push(statement(fn.definition));
  for (const view of catalog.views) sql.push(`create view ${qualified(view.name)}${view.options?.length ? ` with (${view.options.join(", ")})` : ""} as ${statement(view.definition)}`);
  sql.push("set local check_function_bodies=on;");
  for (const table of catalog.tables) for (const column of table.columns) {
    if (column.default && !column.identity) sql.push(`alter table ${qualified(table.name)} alter column ${quote(column.name)} set default ${column.default};`);
  }
  for (const constraint of catalog.constraints) sql.push(`alter table ${qualified(constraint.table_name)} add constraint ${quote(constraint.name)} ${constraint.definition};`);
  for (const index of catalog.indexes) sql.push(statement(index.definition));
  for (const trigger of catalog.triggers) {
    sql.push(statement(trigger.definition));
    const mode = { D: "disable", A: "enable always", R: "enable replica" }[trigger.enabled];
    if (mode) sql.push(`alter table ${quote(trigger.schema_name)}.${quote(trigger.table_name)} ${mode} trigger ${quote(trigger.name)};`);
  }
  for (const table of catalog.tables) {
    if (table.rls) sql.push(`alter table ${qualified(table.name)} enable row level security;`);
    if (table.force_rls) sql.push(`alter table ${qualified(table.name)} force row level security;`);
  }
  const commands = { "*": "all", r: "select", a: "insert", w: "update", d: "delete" };
  for (const policy of catalog.policies) sql.push(`create policy ${quote(policy.name)} on ${qualified(policy.table_name)} as ${policy.permissive ? "permissive" : "restrictive"} for ${commands[policy.command]} to ${policy.roles.map(role).join(", ")}${policy.using_expr ? ` using (${policy.using_expr})` : ""}${policy.check_expr ? ` with check (${policy.check_expr})` : ""};`);
  // Function default EXECUTE for PUBLIC must never survive an absent explicit grant.
  for (const fn of catalog.functions) sql.push(`revoke all on function ${fn.signature} from public, anon, authenticated, service_role;`);
  for (const relation of [...catalog.tables, ...catalog.views]) sql.push(`revoke all on table ${qualified(relation.name)} from public, anon, authenticated, service_role;`);
  for (const sequence of catalog.sequences) sql.push(`revoke all on sequence ${qualified(sequence.name)} from public, anon, authenticated, service_role;`);
  for (const grant of catalog.functionGrants) sql.push(`grant ${grant.privilege} on function ${grant.signature} to ${role(grant.role)}${grant.grantable ? " with grant option" : ""};`);
  for (const grant of catalog.relationGrants) sql.push(`grant ${grant.privilege} on ${grant.kind === "S" ? "sequence" : "table"} ${qualified(grant.name)} to ${role(grant.role)}${grant.grantable ? " with grant option" : ""};`);
  for (const grant of catalog.columnGrants) sql.push(`grant ${grant.privilege} (${quote(grant.name)}) on table ${qualified(grant.table_name)} to ${role(grant.role)}${grant.grantable ? " with grant option" : ""};`);
  sql.push("commit;");
  return `${sql.join("\n\n")}\n`;
}

export function canonicalCatalog(catalog) {
  return Object.fromEntries(Object.entries(catalog).map(([key, rows]) => [key, [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]));
}
