const { spawn, execSync } = require('child_process');
const http = require('http');
const puppeteer = require('puppeteer');

async function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function getNgrokUrl() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:4040/api/tunnels', res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const tunnels = JSON.parse(data).tunnels;
          const tunnel = tunnels.find(t => t.public_url.startsWith('https'));
          if (tunnel) resolve(tunnel.public_url);
          else reject(new Error("No HTTPS tunnel found"));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function run() {
  console.log("Cleaning up port 3000...");
  try {
    // Attempt to kill whatever is on port 3000 using Windows netstat/taskkill
    const output = execSync('netstat -ano | findstr :3000').toString();
    const lines = output.trim().split('\n');
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && pid !== '0') {
        console.log(`Killing PID ${pid} listening on 3000...`);
        execSync(`taskkill /F /PID ${pid}`);
      }
    }
  } catch (e) {
    console.log("Port 3000 seems free or could not be killed.");
  }
  
  // Kill dangling ngrok
  try {
    execSync('taskkill /F /IM ngrok.exe');
  } catch (e) {
    console.log("No ngrok processes to kill.");
  }

  await wait(2000);

  console.log("Starting Next.js specifically on IPv4 127.0.0.1:3000...");
  const nextjs = spawn('npm', ['run', 'dev', '--', '-H', '127.0.0.1', '-p', '3000'], { shell: true });
  nextjs.stdout.on('data', data => console.log(`[NEXT] ${data}`));
  nextjs.stderr.on('data', data => console.error(`[NEXT ERR] ${data}`));

  console.log("Waiting for Next.js to be fully ready...");
  let isNextRunning = false;
  for(let i=0; i<30; i++) {
    await wait(1000);
    try {
      await new Promise((res, rej) => {
        http.get('http://127.0.0.1:3000', r => res()).on('error', rej);
      });
      console.log("Next.js is up on 127.0.0.1:3000!");
      isNextRunning = true;
      break;
    } catch(e) {}
  }

  if (!isNextRunning) {
    console.error("Next.js failed to start.");
    process.exit(1);
  }

  console.log("Starting ngrok targeting 127.0.0.1:3000...");
  const ngrokProcess = spawn('npx', ['ngrok', 'http', '127.0.0.1:3000'], { shell: true });
  
  let ngrokUrl = null;
  for(let i=0; i<15; i++) {
    await wait(2000);
    try {
      ngrokUrl = await getNgrokUrl();
      break;
    } catch(e) {}
  }

  if (!ngrokUrl) {
    console.error("Failed to get ngrok URL. Ensure authtoken is set.");
    process.exit(1);
  }

  console.log(`Ngrok is running at: ${ngrokUrl}`);
  
  const fs = require('fs');
  fs.writeFileSync('URL.txt', ngrokUrl);

  console.log("Testing with Puppeteer...");
  const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  let success = false;
  try {
    const response = await page.goto(`${ngrokUrl}/liff`, { waitUntil: 'networkidle0' });
    if (response.status() === 200) {
      console.log("TEST SUCCESSFUL! 200 OK via IPv4 Ngrok!");
      success = true;
    } else {
      console.error("FAILED. Status:", response.status());
    }
  } catch (err) {
    console.error("FAILED.", err);
  } finally {
    await browser.close();
    if (!success) {
      nextjs.kill();
      ngrokProcess.kill();
      process.exit(1);
    } else {
      console.log("Leaving Next.js and ngrok running in the background for the user...");
      // DO NOT EXIT! Keep the event loop alive by just doing nothing.
      setInterval(() => {}, 100000);
    }
  }
}

run();
