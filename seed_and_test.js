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
  console.log("Checking if tables exist and inserting dummy data...");
  
  // 1. Check if stylists table exists
  const { error: checkError } = await supabase.from('stylists').select('id').limit(1);
  if (checkError) {
    console.error("Error accessing stylists table:", checkError.message);
    if (checkError.code === '42P01') {
      console.log("TABLES DO NOT EXIST. The user has not run the DDL yet.");
      process.exit(2);
    }
    process.exit(1);
  }

  // 2. Insert Stylist
  const { error: stylistError } = await supabase.from('stylists').upsert({
    id: '00000000-0000-0000-0000-000000000001',
    name: 'テスト美容師'
  });
  if (stylistError) console.error("Stylist Insert Error:", stylistError);

  // 3. Insert Subscription
  const { error: subError } = await supabase.from('subscriptions').upsert({
    stylist_id: '00000000-0000-0000-0000-000000000001',
    status: 'active',
    plan_id: 'plan_basic',
    current_period_start: new Date().toISOString(),
    current_period_end: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString()
  });
  if (subError) console.error("Sub Insert Error:", subError);

  // 4. Insert Customer
  const { error: custError } = await supabase.from('customers').upsert({
    id: '11111111-1111-1111-1111-111111111111',
    line_user_id: 'U_dummy_line_id',
    display_name: '山田 太郎',
    phone_number: '090-1234-5678'
  });
  if (custError) console.error("Cust Insert Error:", custError);

  // 5. Insert Booking
  const start = new Date();
  const end = new Date(start.getTime() + 60 * 60 * 1000); // 1 hour later
  
  // Clean up old pending bookings first to avoid duplicates cluttering
  await supabase.from('bookings').delete().eq('status', 'pending');

  const { error: bookError } = await supabase.from('bookings').insert({
    customer_id: '11111111-1111-1111-1111-111111111111',
    stylist_id: '00000000-0000-0000-0000-000000000001',
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    status: 'pending',
    menu_note: '【テスト】カット＆カラー'
  });
  if (bookError) console.error("Booking Insert Error:", bookError);

  console.log("Dummy data inserted successfully.");
  process.exit(0);
}

run();
