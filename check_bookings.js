const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envContent = fs.readFileSync('.env.local', 'utf8');
const getEnv = (key) => {
  const match = envContent.match(new RegExp(`${key}="(.*?)"`));
  return match ? match[1] : null;
};

const supabase = createClient(getEnv('NEXT_PUBLIC_SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));

async function run() {
  const { data, error } = await supabase.from('bookings').select('*');
  console.log(data);
  
  // RLS Policies check
  const { data: policies } = await supabase.rpc('get_policies'); // We can't easily query pg_policies via Rest, but we can just drop and recreate policies
}
run();
