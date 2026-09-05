const https = require('https');

function req(url, options = {}, postData = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };
    if (postData) {
      reqOptions.headers['Content-Length'] = Buffer.byteLength(postData);
      reqOptions.headers['Content-Type'] = 'application/json';
    }
    const r = https.request(reqOptions, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, raw: body }); }
      });
    });
    r.on('error', reject);
    if (postData) r.write(postData);
    r.end();
  });
}

async function check() {
  const login = await req('https://seerat-backend.onrender.com/api/admin/auth/login', { method: 'POST' }, JSON.stringify({ email: 'helpwaladost@gmail.com', password: 'Seerat@99051' }));
  const token = login.body.data.token;
  const queue = await req('https://seerat-backend.onrender.com/api/admin/review-queue?status=ALL', {
    headers: { Authorization: 'Bearer ' + token }
  });
  const reels = (queue.body.data || []).filter(item => item.content_type === 'REEL' || item.format === 'VIDEO');
  console.log('Total Video/Reel items in queue:', reels.length);
  reels.forEach((r, idx) => {
    console.log(`[${idx}] ID: ${r.id} | Status: ${r.status} | MediaURL: ${r.media_url} | Format: ${r.format} | AI: ${r.ai_status}`);
  });
}

check().catch(console.error);
