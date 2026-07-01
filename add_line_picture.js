import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function addLinePictureUrl() {
  const { error } = await supabase.rpc('execute_sql', {
    sql: `
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS line_picture_url TEXT;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS line_user_id TEXT;
    `
  });
  if (error) {
    console.error('RPC failed, trying raw query or REST...', error);
    // Let's just create a SQL file that we can execute manually if needed
  }
}

addLinePictureUrl();
