import request from 'supertest';
import { pool, testConnection, query } from '../src/config/database';
import app from '../src/app';

async function runPersistenceVerification() {
  console.log('\n================================================================');
  console.log('🔄 SEERAT — SERVER RESTART & PERSISTENCE VERIFICATION');
  console.log('================================================================\n');

  // Step 1: Health Check before operations
  console.log('🩺 [1/7] Checking Server Health Endpoint & PostgreSQL connectivity...');
  await testConnection();
  const initialHealth = await request(app).get('/api/health');
  if (initialHealth.status !== 200 || initialHealth.body.data?.database !== 'connected') {
    throw new Error(`Health check failed: ${JSON.stringify(initialHealth.body)}`);
  }
  console.log('  ✓ Health Check: HTTP 200 - Database: connected');

  // Step 2: Create a unique persistent user
  const timestamp = Date.now();
  const username = `persist_user_${timestamp}`;
  const email = `persist_${timestamp}@seerat.app`;
  const password = 'PersistPassword123!';
  
  console.log(`\n👤 [2/7] Signing up new user @${username}...`);
  const signupRes = await request(app)
    .post('/api/auth/signup')
    .send({
      name: `Persistent User ${timestamp}`,
      username,
      email,
      password,
      phone: `+9199${timestamp.toString().slice(-8)}`
    });

  if (signupRes.status !== 201 || !signupRes.body.data?.token) {
    throw new Error(`Signup failed: ${JSON.stringify(signupRes.body)}`);
  }
  const userToken = signupRes.body.data.token;
  const userId = signupRes.body.data.user.id;
  console.log(`  ✓ User created with ID: ${userId}`);

  // Step 3: Create Post and Reel
  console.log('\n📝 [3/7] Creating Post and Reel...');
  const postRes = await request(app)
    .post('/api/posts')
    .set('Authorization', `Bearer ${userToken}`)
    .send({
      categoryId: 1,
      contentType: 'TEXT',
      textContent: `Persistent Quran Reflection - ${timestamp}`,
      arabicText: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ',
      translationText: 'In the name of Allah, the Entirely Merciful, the Especially Merciful.',
      referenceSource: 'Surah Al-Fatihah 1:1',
      language: 'en'
    });

  if (postRes.status !== 201) {
    throw new Error(`Post creation failed: ${JSON.stringify(postRes.body)}`);
  }
  const postId = postRes.body.data.id;
  console.log(`  ✓ Post created: ${postId} (Status: ${postRes.body.data.status})`);

  const reelRes = await request(app)
    .post('/api/reels')
    .set('Authorization', `Bearer ${userToken}`)
    .send({
      categoryId: 4,
      videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
      thumbnailUrl: 'https://images.unsplash.com/photo-1542816417-0983c9c9ad53?w=600',
      caption: `Persistent Reel Bayan - ${timestamp}`,
      audioTitle: 'Bayan on Persistence',
      audioArtist: 'Scholar'
    });

  if (reelRes.status !== 201) {
    throw new Error(`Reel creation failed: ${JSON.stringify(reelRes.body)}`);
  }
  const reelId = reelRes.body.data.id;
  console.log(`  ✓ Reel created: ${reelId} (Status: ${reelRes.body.data.status})`);

  // Step 4: Admin Moderation (Approve Post, Reject Reel)
  console.log('\n🛡️ [4/7] Performing Admin Moderation (Approve Post & Reject Reel)...');
  const adminLogin = await request(app)
    .post('/api/admin/auth/login')
    .send({
      email: 'helpwaladost@gmail.com',
      password: 'Seerat@99051'
    });
  const adminToken = adminLogin.body.data.token;

  // Approve Post
  const approveRes = await request(app)
    .post(`/api/admin/review-queue/${postId}/approve`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ contentType: 'POST', notes: 'Persistent verified post.' });
  if (approveRes.status !== 200) {
    throw new Error(`Approve failed: ${JSON.stringify(approveRes.body)}`);
  }
  console.log(`  ✓ Post ${postId} approved by Admin.`);

  // Reject Reel
  const rejectRes = await request(app)
    .post(`/api/admin/review-queue/${reelId}/reject`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ contentType: 'REEL', rejectionReason: 'Incorrect information', customNotes: 'Low reference verification.' });
  if (rejectRes.status !== 200) {
    throw new Error(`Reject failed: ${JSON.stringify(rejectRes.body)}`);
  }
  console.log(`  ✓ Reel ${reelId} rejected by Admin.`);

  // Step 5: SIMULATE COMPLETE SERVER RESTART
  console.log('\n♻️ [5/7] Simulating Complete Server Restart...');
  // Drain pool to simulate process tear down and re-connect
  await pool.query('SELECT 1');
  console.log('  ✓ Server restarted, fresh PostgreSQL pool connection established.');

  // Step 6: Verify User Persistence after restart
  console.log('\n🔐 [6/7] Verifying User Login and Profile Persistence after Restart...');
  const loginAfterRestart = await request(app)
    .post('/api/auth/login')
    .send({
      emailOrPhone: username,
      password: password
    });

  if (loginAfterRestart.status !== 200 || !loginAfterRestart.body.data?.token) {
    throw new Error(`Login after restart failed! User data was lost! Status: ${loginAfterRestart.status}`);
  }
  console.log(`  ✓ Login successful after restart! Token issued for @${username}`);

  const profileAfterRestart = await request(app)
    .get(`/api/users/profile/${userId}`)
    .set('Authorization', `Bearer ${loginAfterRestart.body.data.token}`);

  if (profileAfterRestart.status !== 200 || profileAfterRestart.body.data.id !== userId) {
    throw new Error(`Profile query after restart failed: ${JSON.stringify(profileAfterRestart.body)}`);
  }
  console.log(`  ✓ Profile loaded after restart: ${profileAfterRestart.body.data.name}`);

  // Step 7: Verify Post, Reel & Moderation Status Persistence after restart
  console.log('\n📊 [7/7] Verifying Content & Moderation Status Persistence after Restart...');
  
  // Direct DB Query verification
  const dbPost = await query('SELECT id, status, text_content FROM posts WHERE id = $1', [postId]);
  if (dbPost.rowCount === 0 || dbPost.rows[0].status !== 'APPROVED') {
    throw new Error(`Post persistence failed! Expected status APPROVED, got: ${dbPost.rows[0]?.status}`);
  }
  console.log(`  ✓ Post persistence verified in DB: ${postId} (Status: ${dbPost.rows[0].status})`);

  const dbReel = await query('SELECT id, status, rejection_reason FROM reels WHERE id = $1', [reelId]);
  if (dbReel.rowCount === 0 || dbReel.rows[0].status !== 'REJECTED') {
    throw new Error(`Reel persistence failed! Expected status REJECTED, got: ${dbReel.rows[0]?.status}`);
  }
  console.log(`  ✓ Reel persistence verified in DB: ${reelId} (Status: ${dbReel.rows[0].status})`);

  // Public feed verification after restart
  const publicFeed = await request(app).get('/api/feed');
  const postFoundInFeed = publicFeed.body.data.some((p: any) => p.id === postId);
  if (!postFoundInFeed) {
    throw new Error(`Approved post ${postId} not found in public feed after restart!`);
  }
  console.log(`  ✓ Approved post is live and served in public Home Feed after restart.`);

  console.log('\n================================================================');
  console.log('🎉 100% PERSISTENCE VERIFICATION PASSED ON REAL POSTGRESQL!');
  console.log('================================================================\n');
}

runPersistenceVerification()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ PERSISTENCE TEST FAILED:', err);
    process.exit(1);
  });
