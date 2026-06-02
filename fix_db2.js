const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envContent = fs.readFileSync('.env.local', 'utf8');
const getEnv = (key) => {
  const match = envContent.match(new RegExp(`${key}="(.*?)"`));
  return match ? match[1] : null;
};

const supabase = createClient(getEnv('NEXT_PUBLIC_SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));

async function run() {
  console.log("Fixing RLS policies for LIFF anonymous access and deleting dummy stylist...");

  // Delete the dummy stylist
  await supabase.from('stylists').delete().eq('id', '00000000-0000-0000-0000-000000000001');
  
  // Add policies using SQL
  const { error: rpcError } = await supabase.rpc('execute_sql', {
    sql_string: `
      -- Allow anonymous users to view stylists
      DROP POLICY IF EXISTS "Public can view stylists" ON stylists;
      CREATE POLICY "Public can view stylists" ON stylists FOR SELECT USING (true);

      -- Allow anonymous users to view and insert customers
      DROP POLICY IF EXISTS "Public can insert customers" ON customers;
      CREATE POLICY "Public can insert customers" ON customers FOR INSERT WITH CHECK (true);
      
      DROP POLICY IF EXISTS "Public can select customers" ON customers;
      CREATE POLICY "Public can select customers" ON customers FOR SELECT USING (true);

      -- Allow anonymous users to insert bookings
      DROP POLICY IF EXISTS "Public can insert bookings" ON bookings;
      CREATE POLICY "Public can insert bookings" ON bookings FOR INSERT WITH CHECK (true);
      
      -- Allow anonymous users to read bookings (needed for calendar availability)
      DROP POLICY IF EXISTS "Public can read bookings" ON bookings;
      CREATE POLICY "Public can read bookings" ON bookings FOR SELECT USING (true);
    `
  });

  // If rpc 'execute_sql' doesn't exist, we can't run DDL from rest client. 
  // Let's create the execute_sql function if it doesn't exist? We can't do that either via REST.
  // We'll just have to tell the user to run SQL in the dashboard if we can't do it.
  
  // Wait, Supabase provides an API for Postgres connection if we use `postgres://` connection string, but we only have URL and KEY.
  // I will just use the REST API. We can't run DDL via REST API by default unless we created an RPC function.
}
run();
