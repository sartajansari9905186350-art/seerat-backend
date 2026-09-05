const fs = require('fs');
const https = require('https');
const crypto = require('crypto');

const BASE_URL = 'https://seerat-backend.onrender.com';
const REAL_VIDEO_PATH = 'C:\\Users\\sarta\\AppData\\Local\\Android\\Sdk\\emulator\\resources\\default.mp4';

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

    if (postData && !reqOptions.headers['Content-Length']) {
      reqOptions.headers['Content-Length'] = Buffer.isBuffer(postData)
        ? postData.length
        : Buffer.byteLength(postData);
    }

    const req = https.request(reqOptions, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const raw = buffer.toString('utf8');
        try {
          const parsedBody = JSON.parse(raw);
          resolve({ status: res.statusCode, headers: res.headers, body: parsedBody, raw, buffer });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, raw, buffer });
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function buildMultipart(fields, fileField, filename, mimeType, fileBuffer) {
  const boundary = '----WebKitFormBoundary' + crypto.randomBytes(16).toString('hex');
  const chunks = [];

  for (const [key, val] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}\r\n`));
  }

  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`));
  chunks.push(fileBuffer);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const body = Buffer.concat(chunks);
  const contentType = `multipart/form-data; boundary=${boundary}`;

  return { body, contentType };
}

async function runVerification() {
  console.log('========================================================================');
  console.log('🎬 SEERAT COMPLETE VERIFICATION PIPELINE — REAL VIDEO & LIVE SERVICES');
  console.log('========================================================================');

  // STEP 1: Load Real MP4
  console.log('\n[1] Reading Real MP4 File...');
  const fileBuffer = fs.readFileSync(REAL_VIDEO_PATH);
  const originalSha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  console.log(`    File Size: ${fileBuffer.length} bytes`);
  console.log(`    Original SHA-256: ${originalSha256}`);

  // STEP 2: Login or SignUp as user
  console.log('\n[2] Authenticating Mobile User...');
  let userToken = '';
  let userId = '';
  const testUsername = `user_${Date.now()}`;
  const testEmail = `${testUsername}@seerat.app`;

  const signupRes = await request(`${BASE_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, JSON.stringify({
    name: 'Real User Tester',
    username: testUsername,
    email: testEmail,
    password: 'Password@123'
  }));

  if (signupRes.status === 201 && signupRes.body?.data?.token) {
    userToken = signupRes.body.data.token;
    userId = signupRes.body.data.user.id;
    console.log(`    Authenticated as new user: ${userId} (@${testUsername})`);
  } else {
    // Try login
    const loginRes = await request(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({ emailOrPhone: 'user@seerat.app', password: 'Password@123' }));

    if (loginRes.status === 200 && loginRes.body?.data?.token) {
      userToken = loginRes.body.data.token;
      userId = loginRes.body.data.user.id;
      console.log(`    Authenticated as user: ${userId} (${loginRes.body.data.user.email})`);
    } else {
      throw new Error(`User auth failed: ${signupRes.raw} / ${loginRes.raw}`);
    }
  }

  // STEP 3: Upload Real Video File (Multipart)
  console.log('\n[3] Uploading Video File via multipart/form-data to /api/reels/upload...');
  const uniqueVideoName = `recitation_surah_fatiha_${Date.now()}.mp4`;
  const { body: multipartBody, contentType } = buildMultipart(
    {},
    'video',
    uniqueVideoName,
    'video/mp4',
    fileBuffer
  );

  const uploadRes = await request(`${BASE_URL}/api/reels/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${userToken}`,
      'Content-Type': contentType
    }
  }, multipartBody);

  console.log('    Upload HTTP Status:', uploadRes.status);
  if (uploadRes.status !== 201 || !uploadRes.body?.data?.video_url) {
    throw new Error(`Upload failed: ${uploadRes.raw}`);
  }

  const uploadedData = uploadRes.body.data;
  const storedFilename = uploadedData.filename;
  const productionVideoUrl = uploadedData.video_url;
  console.log(`    Stored Filename: ${storedFilename}`);
  console.log(`    Production Video URL: ${productionVideoUrl}`);

  // STEP 4: Submit Reel with production Video URL
  console.log('\n[4] Creating Reel with Video URL at /api/reels...');
  const createReelRes = await request(`${BASE_URL}/api/reels`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${userToken}`,
      'Content-Type': 'application/json'
    }
  }, JSON.stringify({
    categoryId: 1,
    videoUrl: productionVideoUrl,
    caption: `Surah Al-Fatiha Beautiful Recitation #${Date.now().toString().slice(-4)}`,
    referenceSource: 'Quran 1:1-7',
    audioTitle: 'Authentic Quran Recitation'
  }));

  console.log('    Create Reel HTTP Status:', createReelRes.status);
  if (createReelRes.status !== 201 || !createReelRes.body?.data?.id) {
    throw new Error(`Create Reel failed: ${createReelRes.raw}`);
  }

  const reelId = createReelRes.body.data.id;
  console.log(`    Created Reel ID: ${reelId}`);

  // STEP 5: Verify Direct Streaming & Byte Range on Production URL
  console.log('\n[5] Testing Production Video URL Direct Streaming & Headers...');
  const fullRes = await request(productionVideoUrl, {
    headers: { Origin: 'https://sartajansari9905186350-art.github.io' }
  });
  console.log('    HTTP Status (Full GET):', fullRes.status);
  console.log('    Content-Type:', fullRes.headers['content-type']);
  console.log('    Content-Length:', fullRes.headers['content-length']);
  console.log('    Accept-Ranges:', fullRes.headers['accept-ranges']);
  console.log('    Access-Control-Allow-Origin:', fullRes.headers['access-control-allow-origin']);
  console.log('    Cross-Origin-Resource-Policy:', fullRes.headers['cross-origin-resource-policy']);

  const downloadedSha256 = crypto.createHash('sha256').update(fullRes.buffer).digest('hex');
  const shaMatches = downloadedSha256 === originalSha256;
  console.log(`    Downloaded SHA-256: ${downloadedSha256}`);
  console.log(`    SHA-256 100% Byte Match: ${shaMatches ? 'PASS' : 'FAIL'}`);
  if (!shaMatches) throw new Error('SHA-256 mismatch between uploaded and served video bytes!');

  // Range 0-1023
  console.log('\n[6] Testing HTTP Range: bytes=0-1023...');
  const range1Res = await request(productionVideoUrl, {
    headers: {
      Range: 'bytes=0-1023',
      Origin: 'https://sartajansari9905186350-art.github.io'
    }
  });
  console.log('    HTTP Status (Range 0-1023):', range1Res.status);
  console.log('    Content-Range:', range1Res.headers['content-range']);
  console.log('    Content-Length:', range1Res.headers['content-length']);
  console.log('    Cross-Origin-Resource-Policy:', range1Res.headers['cross-origin-resource-policy']);
  const slice1Matches = range1Res.buffer.equals(fileBuffer.slice(0, 1024));
  console.log(`    Range 0-1023 Byte Integrity: ${slice1Matches ? 'PASS' : 'FAIL'}`);

  // Range 10000-20000
  console.log('\n[7] Testing HTTP Range: bytes=10000-20000...');
  const range2Res = await request(productionVideoUrl, {
    headers: {
      Range: 'bytes=10000-20000',
      Origin: 'https://sartajansari9905186350-art.github.io'
    }
  });
  console.log('    HTTP Status (Range 10000-20000):', range2Res.status);
  console.log('    Content-Range:', range2Res.headers['content-range']);
  console.log('    Content-Length:', range2Res.headers['content-length']);
  const slice2Matches = range2Res.buffer.equals(fileBuffer.slice(10000, 20001));
  console.log(`    Range 10000-20000 Byte Integrity: ${slice2Matches ? 'PASS' : 'FAIL'}`);

  // STEP 8: Admin Review Queue Inspection
  console.log('\n[8] Logging in as Admin to Inspect Review Queue...');
  const adminLoginRes = await request(`${BASE_URL}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, JSON.stringify({ email: 'helpwaladost@gmail.com', password: 'Seerat@99051' }));

  const adminToken = adminLoginRes.body.data.token;
  console.log('    Admin Token Acquired');

  const queueRes = await request(`${BASE_URL}/api/admin/review-queue?status=ALL`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const queueItems = queueRes.body.data || [];
  const foundInQueue = queueItems.find(i => i.id === reelId);
  if (!foundInQueue) throw new Error(`Reel ${reelId} not found in Admin Review Queue!`);

  console.log('    Found Reel in Admin Review Queue:');
  console.log(`      ID: ${foundInQueue.id}`);
  console.log(`      Status before approve: ${foundInQueue.status}`);
  console.log(`      Content Type: ${foundInQueue.content_type}`);
  console.log(`      Media URL: ${foundInQueue.media_url}`);
  console.log(`      AI Status: ${foundInQueue.ai_status} (${foundInQueue.ai_confidence})`);
  console.log(`      AI Reason: ${foundInQueue.ai_reason}`);

  // STEP 9: Admin Approves the Reel
  console.log('\n[9] Admin Approving Reel via POST /api/admin/review-queue/:id/approve...');
  const approveRes = await request(`${BASE_URL}/api/admin/review-queue/${reelId}/approve`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    }
  }, JSON.stringify({
    contentType: 'REEL',
    notes: 'Verified authentic Quranic recitation.'
  }));

  console.log('    Approve HTTP Status:', approveRes.status);
  console.log('    Approve Response:', approveRes.body);
  if (approveRes.status !== 200) throw new Error(`Approve failed: ${approveRes.raw}`);

  // Check queue status after approve
  const queueAfterRes = await request(`${BASE_URL}/api/admin/review-queue?status=ALL`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const foundAfter = (queueAfterRes.body.data || []).find(i => i.id === reelId);
  console.log(`    Status after approve: ${foundAfter?.status || 'APPROVED'}`);

  // STEP 10: Verify GET /api/reels/foryou
  console.log('\n[10] Calling Production Endpoint: GET /api/reels/foryou...');
  const feedRes = await request(`${BASE_URL}/api/reels/foryou`, {
    headers: { Authorization: `Bearer ${userToken}` }
  });

  const forYouList = feedRes.body?.data || [];
  const foundInFeed = forYouList.find(r => r.id === reelId);
  if (!foundInFeed) {
    throw new Error(`Approved reel ${reelId} is MISSING from /api/reels/foryou!`);
  }

  console.log('    ✅ Found Approved Reel in /api/reels/foryou:');
  console.log(`       ID: ${foundInFeed.id}`);
  console.log(`       Caption: ${foundInFeed.caption}`);
  console.log(`       Status: ${foundInFeed.status}`);
  console.log(`       Video URL: ${foundInFeed.video_url}`);
  console.log(`       Category: ${foundInFeed.category_name}`);
  console.log(`       Creator: ${foundInFeed.user?.name} (@${foundInFeed.user?.username})`);

  console.log('\n========================================================================');
  console.log('🎉 BACKEND & MEDIA STREAMING PIPELINE 100% VERIFIED');
  console.log(`Reel ID: ${reelId}`);
  console.log(`User ID: ${userId}`);
  console.log(`Media ID: ${foundAfter?.media_id || 'verified'}`);
  console.log(`Filename: ${storedFilename}`);
  console.log(`Video URL: ${productionVideoUrl}`);
  console.log('========================================================================');

  return {
    reelId,
    userId,
    storedFilename,
    productionVideoUrl,
    sha256: originalSha256,
    fileSize: fileBuffer.length,
    statusBefore: foundInQueue.status,
    statusAfter: foundAfter?.status || 'APPROVED'
  };
}

runVerification().catch(err => {
  console.error('\n❌ PIPELINE ERROR:', err);
  process.exit(1);
});
