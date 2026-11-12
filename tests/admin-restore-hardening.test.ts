import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { installTestDatabase } from './support/database';
import { readApplicationCatalog, canonicalCatalog } from '../scripts/database-catalog.mjs';

test('restore: detect inherited maintenance grants and public vector RPC; repair preserves data and exact application catalog', async () => {
  const db = new PGlite({ extensions: { vector } });
  try {
    await installTestDatabase(db, { fixtures: false });
    const expected = canonicalCatalog(await readApplicationCatalog(db));
    const snapshot = async () => {
      const rows = [];
      for (const { name } of expected.tables) {
        rows.push((await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) rows from public."${name}" t`)).rows);
      }
      return rows;
    };
    const before = await snapshot();
    const verify = await readFile(new URL('../supabase/verify.sql', import.meta.url), 'utf8');
    const harden = await readFile(new URL('../supabase/restore-hardening.sql', import.meta.url), 'utf8');
    await db.exec(`grant maintain,references,trigger,truncate on public.app_schema_version,public.email_outbox to service_role;
      revoke execute on function public.match_chunks(extensions.vector,integer) from service_role;
      grant execute on function public.match_chunks(extensions.vector,integer) to public;
      grant execute on function public.export_site_snapshot() to public;
      grant execute on function public.reserve_avatar_generation(uuid,uuid,text,text) to public;
      grant execute on function public.settle_payment_reference(text,text,numeric,jsonb) to public;
      grant execute on function public.new_merchant_order_no() to public;
      alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role;`);
    const failures = (await db.query<{check_name:string;passed:boolean}>(verify)).rows.filter((r) => !r.passed).map((r) => r.check_name).sort();
    assert.deepEqual(failures, ['avatar_quota_service_only', 'email_outbox_service_privileges', 'export_snapshot_service_only', 'merchant_order_rpc_service_only', 'vector_search_service_only', 'version_api_write_denied']);
    // RLS cannot stop this whole-table operation. Roll it back to retain fixtures.
    await db.exec('begin; set local role service_role; truncate public.app_schema_version; rollback;');
    assert.deepEqual(await snapshot(), before);
    await db.exec(harden);
    await db.exec(harden);
    assert.deepEqual(canonicalCatalog(await readApplicationCatalog(db)), expected);
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual((await db.query<{passed:boolean}>(verify)).rows.filter((r) => !r.passed), []);
    await db.exec('set role service_role');
    assert.equal((await db.query('select version from public.app_schema_version')).rows.length, 1);
    await assert.rejects(db.exec('truncate public.app_schema_version'), /permission denied/);
    await assert.rejects(db.exec('truncate public.email_outbox'), /permission denied/);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query('select * from public.match_chunks(null,1)'), /permission denied/);
    await db.exec('reset role; set role authenticated');
    await assert.rejects(db.query('select * from public.match_chunks(null,1)'), /permission denied/);
    await db.exec('reset role; set role service_role');
    await db.query('select * from public.match_chunks(null,1)');
    await db.exec('reset role; begin; create table public.restore_default_probe(id int)');
    for (const role of ['anon','authenticated','service_role']) {
      assert.equal((await db.query<{allowed:boolean}>("select has_table_privilege($1,'public.restore_default_probe','SELECT') allowed", [role])).rows[0].allowed, false);
    }
    await db.exec('rollback');
  } finally { await db.close(); }
});
