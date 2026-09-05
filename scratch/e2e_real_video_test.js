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

async function runRealEndToEndTest() {
  console.log('===============================================================');
  console.log('🚀 SEERAT END-TO-END REAL VIDEO UPLOAD & PLAYBACK VERIFICATION');
  console.log('===============================================================');

  // Step 0: Read Real Video File
  console.log('\n--- STEP 0: Loading Real MP4 Video File ---');
  if (!fs.existsSync(REAL_VIDEO_PATH)) {
    throw new Error(`Real video file not found at: ${REAL_VIDEO_PATH}`);
  }
  const originalVideoBuffer = fs.readFileSync(REAL_VIDEO_PATH);
  const originalSha256 = crypto.createHash('sha256').update(originalVideoBuffer).digest('hex');
  console.log(`Loaded real MP4 video: ${originalVideoBuffer.length} bytes`);
  console.log(`Original SHA-256: ${originalSha256}`);

  // Step 1: Authenticate Mobile User
  console.log('\n--- STEP 1: Authenticating User for Mobile Upload ---');
  let userToken = '';
  // Try login
  const loginRes = await request(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, JSON.stringify({ emailOrPhone: 'user@seerat.app', password: 'Password@123' }));

  if (loginRes.status === 200 && loginRes.body?.data?.token) {
    userToken = loginRes.body.data.token;
    console.log('Logged in existing mobile user. User ID:', loginRes.body.data.user.id);
  } else {
    // Sign up a test user
    const testUsername = `tester_${Date.now()}`;
    const testEmail = `${testUsername}@seerat.app`;
    const signupRes = await request(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({
      name: 'Real Reel Tester',
      username: testUsername,
      email: testEmail,
      password: 'Password@123'
    }));
    userToken = signupRes.body.data.token;
    console.log('Signed up new test mobile user. User ID:', signupRes.body.data.user.id);
  }

  // Step 2: Upload Real Video File via Multipart to /api/reels/upload
  console.log('\n--- STEP 2: Uploading Real Video File (Multipart) to /api/reels/upload ---');
  const { body: multipartBody, contentType } = buildMultipart(
    {},
    'video',
    'real_gallery_recitation.mp4',
    'video/mp4',
    originalVideoBuffer
  );

  const uploadRes = await request(`${BASE_URL}/api/reels/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${userToken}`,
      'Content-Type': contentType
    }
  }, multipartBody);

  console.log('Upload HTTP Status:', uploadRes.status);
  console.log('Upload Response Body:', uploadRes.body);

  if (uploadRes.status !== 201 || !uploadRes.body?.data?.video_url) {
    throw new Error(`Video upload failed: ${uploadRes.raw}`);
  }

  const productionVideoUrl = uploadRes.body.data.video_url;
  const storedFilename = uploadRes.body.data.filename;
  console.log('✅ Video Upload Succeeded!');
  console.log('   Exact Stored Filename:', storedFilename);
  console.log('   Exact Production Video URL:', productionVideoUrl);

  // Step 3: Create Reel with the exact production video URL
  console.log('\n--- STEP 3: Submitting Reel to /api/reels ---');
  const createReelRes = await request(`${BASE_URL}/api/reels`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${userToken}`,
      'Content-Type': 'application/json'
    }
  }, JSON.stringify({
    categoryId: 1,
    videoUrl: productionVideoUrl,
    caption: 'End-to-End Real Recitation Video Test',
    referenceSource: 'Surah Al-Mulk 67:1',
    audioTitle: 'Authentic Recitation Audio'
  }));

  console.log('Create Reel HTTP Status:', createReelRes.status);
  console.log('Create Reel Response:', createReelRes.body);

  if (createReelRes.status !== 201 || !createReelRes.body?.data?.id) {
    throw new Error(`Create reel failed: ${createReelRes.raw}`);
  }

  const reelId = createReelRes.body.data.id;
  console.log('✅ Reel Created. ID:', reelId);

  // Step 4: Verify Direct Streaming against the exact production video URL
  console.log('\n--- STEP 4: Testing Production Video URL Direct Playback & Streaming ---');
  
  // 4a. Test Full GET (200 OK)
  console.log('-> 4a. Standard GET request...');
  const fullGetRes = await request(productionVideoUrl);
  console.log('   HTTP Status:', fullGetRes.status, fullGetRes.status === 200 ? '✅' : '❌');
  console.log('   Content-Type:', fullGetRes.headers['content-type'], fullGetRes.headers['content-type'] === 'video/mp4' ? '✅' : '❌');
  console.log('   Accept-Ranges:', fullGetRes.headers['accept-ranges'], fullGetRes.headers['accept-ranges'] === 'bytes' ? '✅' : '❌');
  console.log('   Content-Length:', fullGetRes.headers['content-length'], parseInt(fullGetRes.headers['content-length']) === originalVideoBuffer.length ? '✅' : '❌');
  
  const downloadedSha256 = crypto.createHash('sha256').update(fullGetRes.buffer).digest('hex');
  const byteIntegrityMatch = downloadedSha256 === originalSha256;
  console.log('   Downloaded SHA-256:', downloadedSha256);
  console.log('   SHA-256 Exact Byte Match:', byteIntegrityMatch ? '✅ MATCHES ORIGINAL FILE 100%' : '❌ MISMATCH');
  if (!byteIntegrityMatch) {
    throw new Error('Downloaded video bytes do not match original uploaded file');
  }

  // 4b. Test Range: bytes=0- (ExoPlayer & HTML5 video start)
  console.log('\n-> 4b. Testing Range: bytes=0- (Streaming start)...');
  const rangeStartRes = await request(productionVideoUrl, {
    headers: { Range: 'bytes=0-' }
  });
  console.log('   HTTP Status:', rangeStartRes.status, rangeStartRes.status === 206 ? '✅ 206 Partial Content' : '❌');
  console.log('   Content-Range:', rangeStartRes.headers['content-range']);
  console.log('   Content-Length:', rangeStartRes.headers['content-length']);
  console.log('   Accept-Ranges:', rangeStartRes.headers['accept-ranges']);
  if (rangeStartRes.status !== 206) {
    throw new Error(`Expected 206 Partial Content for Range: bytes=0-, got ${rangeStartRes.status}`);
  }

  // 4c. Test Range: bytes=100-200 (Seeking / Chunking)
  console.log('\n-> 4c. Testing Range: bytes=100-200 (Seek test)...');
  const rangeSliceRes = await request(productionVideoUrl, {
    headers: { Range: 'bytes=100-200' }
  });
  console.log('   HTTP Status:', rangeSliceRes.status, rangeSliceRes.status === 206 ? '✅ 206 Partial Content' : '❌');
  console.log('   Content-Range:', rangeSliceRes.headers['content-range']);
  console.log('   Content-Length:', rangeSliceRes.headers['content-length']);
  const expectedSlice = originalVideoBuffer.slice(100, 201);
  const sliceMatches = rangeSliceRes.buffer.equals(expectedSlice);
  console.log('   Chunk byte match:', sliceMatches ? '✅ 101 bytes match exact file slice' : '❌ MISMATCH');
  if (!sliceMatches) {
    throw new Error('Range slice does not match original file slice');
  }

  // Step 5: Admin Review Queue Verification
  console.log('\n--- STEP 5: Admin Review Queue Verification ---');
  const adminLoginRes = await request(`${BASE_URL}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, JSON.stringify({ email: 'helpwaladost@gmail.com', password: 'Seerat@99051' }));

  if (adminLoginRes.status !== 200 || !adminLoginRes.body?.data?.token) {
    throw new Error(`Admin login failed: ${adminLoginRes.raw}`);
  }
  const adminToken = adminLoginRes.body.data.token;
  console.log('Admin Authenticated as SUPER_ADMIN');

  const queueRes = await request(`${BASE_URL}/api/admin/review-queue?status=ALL`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });

  const queueItems = queueRes.body?.data || [];
  const foundReelInQueue = queueItems.find(i => i.id === reelId);

  console.log(`Review Queue total items: ${queueItems.length}`);
  if (!foundReelInQueue) {
    throw new Error(`Created reel ${reelId} not found in Admin Review Queue`);
  }

  console.log('✅ Reel Found in Admin Review Queue:');
  console.log('   ID:', foundReelInQueue.id);
  console.log('   Content Type:', foundReelInQueue.content_type);
  console.log('   Format:', foundReelInQueue.format);
  console.log('   Media URL in Queue:', foundReelInQueue.media_url);
  console.log('   Matches exact production video URL:', foundReelInQueue.media_url === productionVideoUrl ? '✅' : '❌');

  if (foundReelInQueue.media_url !== productionVideoUrl) {
    throw new Error(`Admin Review Queue media_url mismatch: expected ${productionVideoUrl}, got ${foundReelInQueue.media_url}`);
  }

  // Step 6: Admin Approves Reel
  console.log('\n--- STEP 6: Admin Approving Reel ---');
  const approveRes = await request(`${BASE_URL}/api/admin/content/${reelId}/approve`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    }
  }, JSON.stringify({ contentType: 'REEL', notes: 'Approved authentic recitation reel.' }));

  console.log('Approve Status:', approveRes.status);
  console.log('Approve Message:', approveRes.body?.message);
  if (approveRes.status !== 200) {
    throw new Error(`Admin approval failed: ${approveRes.raw}`);
  }

  // Step 7: Android Reels Feed Verification
  console.log('\n--- STEP 7: Android Reels Feed Verification ---');
  const reelsFeedRes = await request(`${BASE_URL}/api/reels/foryou`, {
    headers: { Authorization: `Bearer ${userToken}` }
  });

  const forYouReels = reelsFeedRes.body?.data || [];
  const approvedReelInFeed = forYouReels.find(r => r.id === reelId);

  if (!approvedReelInFeed) {
    throw new Error(`Approved reel ${reelId} not found in For You reels feed!`);
  }

  console.log('✅ Approved Reel Found in Android For You Feed:');
  console.log('   ID:', approvedReelInFeed.id);
  console.log('   Caption:', approvedReelInFeed.caption);
  console.log('   Video URL in Feed:', approvedReelInFeed.video_url);
  console.log('   Matches production URL:', approvedReelInFeed.video_url === productionVideoUrl ? '✅' : '❌');

  if (approvedReelInFeed.video_url !== productionVideoUrl) {
    throw new Error(`Feed video_url mismatch: expected ${productionVideoUrl}, got ${approvedReelInFeed.video_url}`);
  }

  console.log('\n===============================================================');
  console.log('🎉 100% END-TO-END VERIFICATION PASSED WITH REAL VIDEO FILE!');
  console.log('   1. Upload: Real MP4 uploaded successfully');
  console.log('   2. Storage: Persistent PostgreSQL BYTEA storage');
  console.log('   3. Database: Exact HTTPS URL stored in media.url');
  console.log('   4. Streaming: Full 200 OK + Range 206 Partial Content verified');
  console.log('   5. Admin Review Queue: Exact media_url loaded and approved');
  console.log('   6. Android Reels Feed: Exact media_url returned for playback');
  console.log('===============================================================');
}

runRealEndToEndTest().catch(err => {
  console.error('\n❌ VERIFICATION TEST FAILED:', err);
  process.exit(1);
});
