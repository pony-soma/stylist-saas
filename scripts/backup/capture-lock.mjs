// Experimental capture primitive. No CLI and no automatic production activation.
// Relation locks freeze rows, not external object bytes, sequences or admin DDL.
const schemas = ['public', 'auth', 'storage', 'supabase_migrations'];
const excluded = new Set(['auth.schema_migrations', 'storage.migrations',
  'storage.buckets_vectors', 'storage.vector_indexes']);
const quote = value => '"' + value.replaceAll('"', '""') + '"';

export async function acquireCaptureLock(client) {
  let begun = false;
  try {
    const {rows: [identity]} = await client.query(
      'select current_user as role, rolsuper from pg_roles where rolname=current_user');
    if (identity?.role !== 'postgres' || identity.rolsuper !== false)
      throw Error('Capture requires ordinary postgres');
    await client.query('begin');
    begun = true;
    await client.query("set local lock_timeout='3s'; set local statement_timeout='10s'; set local idle_in_transaction_session_timeout='90s'");
    const inventory = async () => (await client.query(`
      select n.nspname as schema, c.relname as name, c.oid::text as oid,
        has_table_privilege(current_user,c.oid,'UPDATE') as can_lock
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname=any($1::text[]) and c.relkind in ('r','p')
      order by n.nspname,c.relname`, [schemas])).rows;
    const before = await inventory();
    const tables = before.filter(t => !excluded.has(t.schema+'.'+t.name));
    if (!tables.length || tables.some(t => !t.can_lock)
        || !['public.stylists','auth.users','storage.objects','storage.buckets']
          .every(name => tables.some(t => t.schema+'.'+t.name===name)))
      throw Error('Capture relation inventory is incomplete');
    // One statement: an active writer must finish before acquisition succeeds.
    // Failure rolls the whole transaction back; no partial freeze is retained.
    await client.query('lock table '+tables.map(t => quote(t.schema)+'.'+quote(t.name)).join(', ')
      +' in share mode');
    if (JSON.stringify(before)!==JSON.stringify(await inventory()))
      throw Error('Capture relation inventory changed');
    for (const t of before.filter(t => ['storage.buckets_vectors','storage.vector_indexes'].includes(t.schema+'.'+t.name))) {
      const {rows:[row]} = await client.query('select exists(select 1 from '+quote(t.schema)+'.'+quote(t.name)+') as populated');
      if (row.populated) throw Error('Vector storage needs separate capture review');
    }
    let released = false;
    return {
      tableCount: tables.length,
      // Actual locks must still exist on this exact connection. Never reconnect.
      async verify() {
        if (released) throw Error('Capture lock was released');
        const {rows:[row]} = await client.query(`select count(distinct relation)::int as held
          from pg_locks where pid=pg_backend_pid() and granted and mode='ShareLock'
          and relation=any($1::oid[])`, [tables.map(t => t.oid)]);
        if (row.held!==tables.length || JSON.stringify(before)!==JSON.stringify(await inventory()))
          throw Error('Capture lock or relation inventory lost');
      },
      async release() {
        if (!released) { released=true; await client.query('rollback'); }
      },
    };
  } catch (error) {
    if (begun) await client.query('rollback').catch(()=>{});
    // SQL errors can contain connection/row details; expose only a generic error.
    throw Error('Capture lock acquisition failed');
  }
}
