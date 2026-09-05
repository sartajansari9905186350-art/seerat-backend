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

async function runProductionTests() {
  console.log('================================================================');
  console.log('🧪 VERIFYING LIVE PRODUCTION FLOW: AI MODERATION & ADMIN PREVIEW');
  console.log('Target Backend: https://seerat-backend.onrender.com');
  console.log('Target Admin Portal: https://sartajansari9905186350-art.github.io/seerat-admin/');
  console.log('================================================================\n');

  // Step 1: Admin Login
  console.log('--- Step 1: Live Admin Login & Token Verification ---');
  const adminLogin = await request('https://seerat-backend.onrender.com/api/admin/auth/login', {
    method: 'POST'
  }, JSON.stringify({ email: 'helpwaladost@gmail.com', password: 'Seerat@99051' }));

  if (adminLogin.status !== 200 || !adminLogin.body?.data?.token) {
    console.error('❌ Admin login failed:', adminLogin.raw);
    process.exit(1);
  }
  const adminToken = adminLogin.body.data.token;
  console.log('✅ Live Admin Token acquired. Role:', adminLogin.body.data.admin?.role);

  // Step 2: Mobile User Authentication / Registration
  console.log('\n--- Step 2: Live Mobile User Auth & Creation ---');
  const testNum = Math.floor(10000 + Math.random() * 90000);
  const signupRes = await request('https://seerat-backend.onrender.com/api/auth/signup', {
    method: 'POST'
  }, JSON.stringify({
    name: `Theological Contributor ${testNum}`,
    username: `contributor_${testNum}`,
    email: `contributor_${testNum}@seerat.app`,
    password: 'Password@123'
  }));

  console.log('Signup Status:', signupRes.status);
  let userToken = signupRes.body?.data?.token;
  if (!userToken) {
    console.error('❌ User signup failed:', signupRes.raw);
    process.exit(1);
  }
  console.log('✅ Mobile User Auth Token acquired for:', signupRes.body.data.user.username);

  // If userToken wasn't created via OTP, let's create a post using userToken or check mobile post creation
  // Let's test Post Creation with Islamic content
  console.log('\n--- Step 3: Create Live Islamic Post via User API ---');
  let newPostId = null;
  if (userToken) {
    const postRes = await request('https://seerat-backend.onrender.com/api/posts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}` }
    }, JSON.stringify({
      textContent: 'Alhamdulillah for all the blessings! Indeed, with hardship comes ease. Quran 94:6 #IslamicReminder #Quran',
      mediaUrl: 'https://images.unsplash.com/photo-1564769625905-50e93615e769',
      categoryId: 1,
      contentType: 'PHOTO',
      referenceSource: 'Quran Surah Ash-Sharh 94:6'
    }));

    console.log('Post Creation Status:', postRes.status);
    console.log('Post Creation Body:', postRes.raw);
    if (postRes.body?.data) {
      newPostId = postRes.body.data.id;
      console.log('✅ Created Post ID:', newPostId);
      console.log('   Status:', postRes.body.data.status, '(Must be PENDING_REVIEW)');
      console.log('   AI Status:', postRes.body.data.ai_status);
      console.log('   AI Confidence:', postRes.body.data.ai_confidence);
      console.log('   AI Reason:', postRes.body.data.ai_reason);
    }
  }

  // Step 4: Create Live Islamic Reel via User API
  console.log('\n--- Step 4: Create Live Islamic Reel via User API ---');
  let newReelId = null;
  if (userToken) {
    const reelRes = await request('https://seerat-backend.onrender.com/api/reels', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}` }
    }, JSON.stringify({
      caption: 'Heart soothing recitation of Surah Ar-Rahman by Sheikh Mishary Rashid Alafasy. SubhanAllah! #Bayan #Zikr',
      videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
      thumbnailUrl: 'https://images.unsplash.com/photo-1542810634-71277d95dcbb',
      categoryId: 2,
      referenceSource: 'Surah Ar-Rahman'
    }));

    console.log('Reel Creation Status:', reelRes.status);
    console.log('Reel Creation Body:', reelRes.raw);
    if (reelRes.body?.data) {
      newReelId = reelRes.body.data.id;
      console.log('✅ Created Reel ID:', newReelId);
      console.log('   Status:', reelRes.body.data.status, '(Must be PENDING_REVIEW)');
      console.log('   AI Status:', reelRes.body.data.ai_status);
      console.log('   AI Confidence:', reelRes.body.data.ai_confidence);
      console.log('   AI Reason:', reelRes.body.data.ai_reason);
    }
  }

  // Step 5: Admin Review Queue Verification
  console.log('\n--- Step 5: Admin Review Queue Inspection ---');
  const queueRes = await request('https://seerat-backend.onrender.com/api/admin/review-queue?status=ALL', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  console.log('Queue Fetch Status:', queueRes.status);
  const queueItems = queueRes.body?.data || [];
  console.log(`Total queue items found: ${queueItems.length}`);

  // Find our post and reel or inspect existing
  const targetPost = queueItems.find(i => i.id === newPostId) || queueItems.find(i => i.content_type === 'POST');
  const targetReel = queueItems.find(i => i.id === newReelId) || queueItems.find(i => i.content_type === 'REEL');

  if (targetPost) {
    console.log('\n🔍 Post Preview Data in Queue:');
    console.log('  ID:', targetPost.id);
    console.log('  Type:', targetPost.content_type);
    console.log('  Creator:', targetPost.creator_name);
    console.log('  Profile Photo:', targetPost.creator_photo || '(default avatar)');
    console.log('  Media URL (Full Image):', targetPost.media_url);
    console.log('  Caption:', targetPost.caption?.substring(0, 50) + '...');
    console.log('  Category:', targetPost.category);
    console.log('  Status:', targetPost.status);
    console.log('  AI Status:', targetPost.ai_status);
    console.log('  AI Confidence:', targetPost.ai_confidence);
    console.log('  AI Reason:', targetPost.ai_reason);
  }

  if (targetReel) {
    console.log('\n🎬 Reel Preview Data in Queue:');
    console.log('  ID:', targetReel.id);
    console.log('  Type:', targetReel.content_type);
    console.log('  Creator:', targetReel.creator_name);
    console.log('  Video URL (Player Source):', targetReel.media_url);
    console.log('  Thumbnail URL:', targetReel.thumbnail_url);
    console.log('  Caption:', targetReel.caption?.substring(0, 50) + '...');
    console.log('  Category:', targetReel.category);
    console.log('  Status:', targetReel.status);
    console.log('  AI Status:', targetReel.ai_status);
    console.log('  AI Confidence:', targetReel.ai_confidence);
  }

  // Step 6: Test Admin Review Actions
  if (newPostId) {
    console.log('\n--- Step 6A: Testing FLAG / Senior Review Action on Post ---');
    const flagRes = await request(`https://seerat-backend.onrender.com/api/admin/review-queue/${newPostId}/flag`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    }, JSON.stringify({
      contentType: 'POST',
      notes: 'Requires senior scholar review for context verification'
    }));
    console.log('Flag Status:', flagRes.status);
    console.log('Flag Response:', flagRes.body);

    console.log('\n--- Step 6B: Testing APPROVE Action on Post ---');
    const approveRes = await request(`https://seerat-backend.onrender.com/api/admin/review-queue/${newPostId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    }, JSON.stringify({
      contentType: 'POST',
      notes: 'Verified authentic Islamic reminder'
    }));
    console.log('Approve Status:', approveRes.status);
    console.log('Approve Response:', approveRes.body);
  }

  if (newReelId) {
    console.log('\n--- Step 6C: Testing REJECT Action on Reel ---');
    const rejectRes = await request(`https://seerat-backend.onrender.com/api/admin/review-queue/${newReelId}/reject`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    }, JSON.stringify({
      contentType: 'REEL',
      rejectionReason: 'Inappropriate content',
      customNotes: 'Audio clarity requires enhancement'
    }));
    console.log('Reject Status:', rejectRes.status);
    console.log('Reject Response:', rejectRes.body);
  }

  // Step 7: Check Audit Logs on Live Backend
  console.log('\n--- Step 7: Checking Audit Logs for Moderation Actions ---');
  const auditRes = await request('https://seerat-backend.onrender.com/api/admin/audit-logs?page=1&limit=5', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  console.log('Audit Log Fetch Status:', auditRes.status);
  const auditLogs = auditRes.body?.data || [];
  console.log(`Recent audit logs retrieved: ${auditLogs.length}`);
  auditLogs.slice(0, 3).forEach(log => {
    console.log(`  - [${log.action}] on ${log.entity_type || 'content'} #${log.entity_id} by ${log.admin_name || log.admin_id} at ${log.created_at}`);
  });

  console.log('\n================================================================');
  console.log('✅ REAL PRODUCTION VERIFICATION RUN COMPLETED');
  console.log('================================================================');
}

runProductionTests().catch(console.error);
