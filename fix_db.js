const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');

const getEnv = (key) => {
  const match = envContent.match(new RegExp(`${key}="(.*?)"`));
  return match ? match[1] : null;
};

const SUPABASE_URL = getEnv('NEXT_PUBLIC_SUPABASE_URL');
const SUPABASE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Environment variables missing");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false }
});

async function run() {
  console.log("Fixing missing stylists and subscriptions...");
  
  // 1. Get all users
  const { data: { users }, error: usersError } = await supabase.auth.admin.listUsers();
  if (usersError) {
    console.error("Error fetching users:", usersError);
    process.exit(1);
  }

  console.log(`Found ${users.length} users.`);

  for (const user of users) {
    // Check if stylist exists
    const { data: stylist } = await supabase.from('stylists').select('id').eq('id', user.id).single();
    if (!stylist) {
      console.log(`Inserting stylist for ${user.email} (${user.id})...`);
      await supabase.from('stylists').insert({
        id: user.id,
        name: user.user_metadata?.full_name || '美容師'
      });
    }

    // Check if subscription exists
    const { data: sub } = await supabase.from('subscriptions').select('id').eq('stylist_id', user.id).single();
    if (!sub) {
      console.log(`Inserting subscription for ${user.email} (${user.id})...`);
      const start = new Date();
      const end = new Date(start.getTime() + 100 * 365 * 24 * 60 * 60 * 1000); // 100 years
      await supabase.from('subscriptions').insert({
        stylist_id: user.id,
        status: 'active',
        plan_id: 'plan_basic',
        current_period_start: start.toISOString(),
        current_period_end: end.toISOString()
      });
    }
  }

  console.log("Database backfill completed successfully.");
}

run();
