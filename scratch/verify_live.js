const https = require('https');

function request(url, options = {}, postData = null) {
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
      if (!reqOptions.headers['Content-Type']) {
        reqOptions.headers['Content-Type'] = 'application/json';
      }
    }

    const req = https.request(reqOptions, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsedBody = JSON.parse(body);
          resolve({ status: res.statusCode, headers: res.headers, body: parsedBody, raw: body });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, raw: body });
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function run() {
  console.log('\n--- 1. Testing Admin Authentication on Live Render Backend ---');
  const loginRes = await request('https://seerat-backend.onrender.com/api/admin/auth/login', {
    method: 'POST'
  }, JSON.stringify({ email: 'helpwaladost@gmail.com', password: 'Seerat@99051' }));

  console.log('Login Status:', loginRes.status);
  if (!loginRes.body || !loginRes.body.data || !loginRes.body.data.token) {
    console.error('Login failed:', loginRes.raw);
    return;
  }

  const token = loginRes.body.data.token;
  console.log('Admin Token Acquired. Role:', loginRes.body.data.admin?.role || 'SUPER_ADMIN');

  console.log('\n--- 2. Checking Review Queue for AI Moderation Fields ---');
  const queueRes = await request('https://seerat-backend.onrender.com/api/admin/review-queue?status=ALL', {
    headers: { Authorization: `Bearer ${token}` }
  });

  console.log('Queue Status:', queueRes.status);
  if (queueRes.body && queueRes.body.data) {
    const items = queueRes.body.data;
    console.log(`Total queue items: ${items.length}`);
    if (items.length > 0) {
      const sample = items[0];
      console.log('Sample Item Fields:');
      console.log('  ID:', sample.id);
      console.log('  Format:', sample.format);
      console.log('  Content Type:', sample.content_type);
      console.log('  Status:', sample.status);
      console.log('  AI Status:', sample.ai_status);
      console.log('  AI Confidence:', sample.ai_confidence);
      console.log('  AI Reason:', sample.ai_reason);
      console.log('  Creator:', sample.creator_name);
    }
  }

  console.log('\n--- 3. Checking Live Admin Portal on GitHub Pages ---');
  const ghPagesRes = await request('https://sartajansari9905186350-art.github.io/seerat-admin/');
  console.log('GitHub Pages Status:', ghPagesRes.status);
  const html = ghPagesRes.raw || '';
  console.log('Has AI Screening header:', html.includes('AI Screening'));
  console.log('Has Flag modal:', html.includes('modal-flag-content'));
  console.log('Has Media preview modal:', html.includes('modal-media-preview'));
  console.log('Has reviewQueue.js script:', html.includes('reviewQueue.js'));

  console.log('\n--- 4. Checking Live reviewQueue.js on GitHub Pages ---');
  const jsRes = await request('https://sartajansari9905186350-art.github.io/seerat-admin/js/reviewQueue.js');
  console.log('reviewQueue.js Status:', jsRes.status);
  const js = jsRes.raw || '';
  console.log('Has getAiPill:', js.includes('getAiPill'));
  console.log('Has openFlagModal:', js.includes('openFlagModal'));
  console.log('Has HTML5 video player:', js.includes('preview-video-element'));
}

run().catch(console.error);
