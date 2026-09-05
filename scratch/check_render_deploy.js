const https = require('https');

function check() {
  return new Promise((resolve) => {
    https.get('https://seerat-backend.onrender.com/api/health', (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    }).on('error', (err) => resolve({ error: err.message }));
  });
}

async function loop() {
  console.log('Waiting for Render deployment...');
  for (let i = 0; i < 30; i++) {
    const res = await check();
    if (res.status === 200 && res.body?.success) {
      console.log(`[Attempt ${i+1}] Render backend healthy:`, res.body.data?.status);
      return;
    }
    console.log(`[Attempt ${i+1}] Status: ${res.status || res.error}. Retrying in 5s...`);
    await new Promise(r => setTimeout(r, 5000));
  }
}

loop();
