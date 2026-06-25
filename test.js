const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8');
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL="(.*?)"/)[1];
const key = env.match(/SUPABASE_SERVICE_ROLE_KEY="(.*?)"/)[1];
fetch(url + '/rest/v1/bookings?select=source&limit=1', {
  headers: { 'apikey': key, 'Authorization': 'Bearer ' + key }
}).then(r => r.json()).then(console.log).catch(console.error);
