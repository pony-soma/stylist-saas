const puppeteer = require('puppeteer');
const http = require('http');

async function waitForServer(url) {
  for (let i = 0; i < 30; i++) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
          res.resume(); // consume data
          resolve(res.statusCode);
        });
        req.on('error', reject);
      });
      return true;
    } catch (e) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return false;
}

async function run() {
  const port = process.env.PORT || 3000;
  const baseUrl = `http://localhost:${port}`;
  
  console.log(`Waiting for server on ${baseUrl}...`);
  const isUp = await waitForServer(baseUrl);
  if (!isUp) {
    console.error("Server did not start.");
    process.exit(1);
  }
  
  console.log("Server is up. Launching Puppeteer...");
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err.toString()));
  page.on('response', response => {
    if (response.status() >= 400) {
      console.log(`HTTP ${response.status()} on ${response.url()}`);
    }
  });

  try {
    console.log(`Navigating to ${baseUrl}/login...`);
    await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle0' });
    console.log("Found login button. Clicking Google Login...");
    await page.click('button');
    
    // wait for navigation or a few seconds
    await Promise.race([
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
      new Promise(r => setTimeout(r, 5000))
    ]);
    
    const currentUrl = page.url();
    console.log(`Current URL after click: ${currentUrl}`);
    if (currentUrl.includes('supabase.co') || currentUrl.includes('google.com')) {
      console.log("Google Auth redirect successful!");
    } else {
      console.log("Did not redirect correctly.");
    }
    
    console.log(`\nNavigating to ${baseUrl}/liff...`);
    await page.goto(`${baseUrl}/liff`, { waitUntil: 'networkidle0' });
    console.log("LIFF page loaded.");
    await new Promise(r => setTimeout(r, 2000));
    
  } catch (err) {
    console.error("Test failed:", err);
  } finally {
    await browser.close();
    console.log("E2E tests finished.");
  }
}

run();
