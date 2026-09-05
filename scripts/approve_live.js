const https = require('https');

function request(options, data) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, text: body });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function main() {
  const loginRes = await request({
    hostname: 'seerat-backend.onrender.com',
    path: '/api/admin/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: 'admin@seerat.app', password: 'Admin@Seerat2026!' });

  const token = loginRes.data?.data?.token;
  if (!token) {
    console.error('Failed to get token');
    process.exit(1);
  }

  const queueRes = await request({
    hostname: 'seerat-backend.onrender.com',
    path: '/api/admin/review-queue?limit=20',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` }
  });

  console.log('RAW QUEUE RES:', JSON.stringify(queueRes.data, null, 2));

  const items = Array.isArray(queueRes.data?.data) ? queueRes.data.data : [];
  console.log(`Found ${items.length} items in review queue`);

  for (const item of items) {
    const type = item.content_type || item.contentType || (item.video_url ? 'REEL' : 'POST');
    console.log(`Approving ${item.id} (${type})...`);
    const approveRes = await request({
      hostname: 'seerat-backend.onrender.com',
      path: `/api/admin/review-queue/${item.id}/approve`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }, { contentType: type, notes: 'Verified in e2e testing' });
    console.log(`Result for ${item.id}:`, approveRes.status, approveRes.data?.message || approveRes.data);
  }
}

main().catch(console.error);
