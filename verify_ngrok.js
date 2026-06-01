const { spawn } = require('child_process');
const http = require('http');
const puppeteer = require('puppeteer');

async function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// 1. Next.js が 3000 で起動しているか確認。いなければ起動する。
function isPortInUse(port) {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${port}`, res => {
      resolve(true);
    }).on('error', () => {
      resolve(false);
    });
  });
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
  console.log("Checking Next.js on port 3000...");
  let isNextRunning = await isPortInUse(3000);
  
  if (!isNextRunning) {
    console.log("Next.js is not running on 3000. Starting it...");
    const nextjs = spawn('npm', ['run', 'dev', '--', '-p', '3000'], { shell: true, stdio: 'ignore' });
    for(let i=0; i<30; i++) {
      await wait(1000);
      if (await isPortInUse(3000)) {
        console.log("Next.js started successfully.");
        isNextRunning = true;
        break;
      }
    }
  }

  if (!isNextRunning) {
    console.error("Failed to start Next.js.");
    process.exit(1);
  }

  console.log("Starting ngrok targeting 127.0.0.1:3000...");
  // Kill existing ngrok just in case
  spawn('taskkill', ['/IM', 'ngrok.exe', '/F'], { shell: true });
  await wait(2000);

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
  console.log(`Testing the URL with Puppeteer to ensure no ERR_NGROK_8012...`);

  const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  try {
    const response = await page.goto(`${ngrokUrl}/liff`, { waitUntil: 'networkidle0' });
    const status = response.status();
    console.log(`Response Status: ${status}`);
    
    if (status === 200) {
      console.log("VERIFICATION SUCCESSFUL: Page loaded properly via ngrok over IPv4 (127.0.0.1).");
    } else {
      console.error(`VERIFICATION FAILED: Received status ${status}`);
    }
  } catch (err) {
    console.error("VERIFICATION FAILED: Error navigating to ngrok URL.", err);
  } finally {
    await browser.close();
    ngrokProcess.kill();
    spawn('taskkill', ['/IM', 'ngrok.exe', '/F'], { shell: true });
    console.log("Finished validation.");
    process.exit(0);
  }
}

run();
