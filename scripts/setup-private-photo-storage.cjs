// Run with the target environment's server credentials. Never print keys.
// Default is read-only. --create creates a missing private bucket; existing
// --harden updates an existing bucket only after an explicit release marker.
// Production execution requires the user's separate release approval.
const { createClient } = require('@supabase/supabase-js');
async function main(args = process.argv.slice(2), env = process.env, makeClient = createClient) {
  const refIndex = args.indexOf('--project-ref');
  const ref = refIndex >= 0 ? args[refIndex + 1] : '';
  if (!/^[a-z]{20}$/.test(ref) || args.some((arg, index) =>
    !['--project-ref', '--create', '--harden'].includes(arg) && index !== refIndex + 1)) {
    throw Error('Usage: node scripts/setup-private-photo-storage.cjs --project-ref <expected-project-ref> [--create|--harden]');
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (url !== `https://${ref}.supabase.co` || !key) throw Error('Target URL or server credential missing/mismatched');
  if (args.includes('--create') && args.includes('--harden')) throw Error('Choose only one mutation');
  if (args.includes('--harden') && env.LINO_STORAGE_RELEASE_APPROVAL !== ref) throw Error('Explicit target-specific Storage release marker required');
  const admin = makeClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.storage.listBuckets();
  if (error || !data) throw Error('Cannot inspect Storage configuration');
  let bucket = data.find(item => item.id === 'record-photos');
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (args.includes('--harden')) {
    if (!bucket) throw Error('Photo bucket missing; refusing implicit creation');
    const result = await admin.storage.updateBucket('record-photos', {
      public: false, fileSizeLimit: 10 * 1024 * 1024, allowedMimeTypes: allowed,
    });
    if (result.error) throw Error('Photo bucket update failed');
    const verified = await admin.storage.getBucket('record-photos');
    if (verified.error || !verified.data) throw Error('Cannot verify updated bucket');
    bucket = verified.data;
  }
  if (bucket) {
    if (bucket.public !== false || !bucket.file_size_limit || bucket.file_size_limit > 10 * 1024 * 1024 ||
      !bucket.allowed_mime_types?.length || bucket.allowed_mime_types.some(type => !allowed.includes(type))) {
      throw Error('Photo bucket does not meet private photo requirements');
    }
    console.log('Private photo bucket configuration verified');
    return;
  }
  if (!args.includes('--create')) throw Error('Photo bucket missing; create explicitly in the approved environment');
  const result = await admin.storage.createBucket('record-photos', {
    public: false, fileSizeLimit: 10 * 1024 * 1024, allowedMimeTypes: allowed,
  });
  if (result.error) throw Error('Private photo bucket creation failed');
  console.log('Private photo bucket created; client uploads remain denied until their authorization is implemented');
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
