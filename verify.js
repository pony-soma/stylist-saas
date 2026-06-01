const http = require('http');

function checkUrl(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, length: data.length });
      });
    }).on('error', reject);
  });
}

async function verify() {
  try {
    console.log("Waiting for Next.js to be ready...");
    await new Promise(r => setTimeout(r, 5000)); // wait for dev server

    console.log("Checking /admin ...");
    const adminRes = await checkUrl('http://localhost:3000/admin');
    console.log(`/admin Status: ${adminRes.statusCode}, Length: ${adminRes.length}`);
    if (adminRes.statusCode !== 200) throw new Error("Admin page failed");

    console.log("Checking /liff ...");
    const liffRes = await checkUrl('http://localhost:3000/liff');
    console.log(`/liff Status: ${liffRes.statusCode}, Length: ${liffRes.length}`);
    if (liffRes.statusCode !== 200) throw new Error("LIFF page failed");

    console.log("All checks passed!");
    process.exit(0);
  } catch (err) {
    console.error("Verification failed:", err.message);
    process.exit(1);
  }
}

verify();
