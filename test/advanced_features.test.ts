import request from 'supertest';
import { pool, testConnection } from '../src/config/database';
import app from '../src/app';

async function runAdvancedFeaturesTest() {
  console.log('\n================================================================');
  console.log('🌟 SEERAT ADVANCED REELS & ADMIN MODERATION TEST SUITE');
  console.log('================================================================\n');

  await testConnection();

  // Setup test admin (SUPER_ADMIN) and moderator
  console.log('🔑 [1/7] Authenticating Test Admins and Mobile Users...');
  const adminLogin = await request(app)
    .post('/api/admin/auth/login')
    .send({
      email: 'helpwaladost@gmail.com',
      password: process.env.ADMIN_INITIAL_PASSWORD || 'Seerat@99051'
    });

  if (adminLogin.status !== 200 || !adminLogin.body.data?.token) {
    throw new Error(`Admin login failed: ${JSON.stringify(adminLogin.body)}`);
  }
  const adminToken = adminLogin.body.data.token;
  console.log('  ✓ Super Admin logged in successfully.');

  // Create or login 2 test mobile users
  const user1Email = `user1_${Date.now()}@seerat.test`;
  const user1Signup = await request(app)
    .post('/api/auth/signup')
    .send({
      name: 'User One',
      username: `u1_${Date.now()}`.substring(0, 20),
      email: user1Email,
      password: 'Password123!'
    });
  const user1Token = user1Signup.body.data.token;
  const user1Id = user1Signup.body.data.user.id;

  const user2Email = `user2_${Date.now()}@seerat.test`;
  const user2Signup = await request(app)
    .post('/api/auth/signup')
    .send({
      name: 'User Two',
      username: `u2_${Date.now()}`.substring(0, 20),
      email: user2Email,
      password: 'Password123!'
    });
  const user2Token = user2Signup.body.data.token;
  const user2Id = user2Signup.body.data.user.id;
  console.log(`  ✓ Test users created: User1 (${user1Id}), User2 (${user2Id})`);

  // Create a reel from user2
  const reelRes = await request(app)
    .post('/api/reels')
    .set('Authorization', `Bearer ${user2Token}`)
    .send({
      categoryId: 2,
      caption: 'Authentic Quran recitation for testing',
      videoUrl: 'https://seerat-backend.onrender.com/api/uploads/videos/test_reel.mp4',
      referenceSource: 'Surah Al-Baqarah 255'
    });
  const testReelId = reelRes.body.data.id;
  console.log(`  ✓ Reel created (PENDING_REVIEW): ${testReelId}`);

  // Test 2: Duplicate community report prevention
  console.log('\n🛡️ [2/7] Testing Community Report with Duplicate Prevention...');
  const report1 = await request(app)
    .post('/api/reports')
    .set('Authorization', `Bearer ${user1Token}`)
    .send({
      targetType: 'REEL',
      targetId: testReelId,
      reason: 'Inappropriate content',
      details: 'Needs review'
    });
  if (report1.status !== 201) {
    throw new Error(`Report 1 failed: ${report1.status} ${JSON.stringify(report1.body)}`);
  }
  console.log('  ✓ First report accepted (HTTP 201).');

  const reportDuplicate = await request(app)
    .post('/api/reports')
    .set('Authorization', `Bearer ${user1Token}`)
    .send({
      targetType: 'REEL',
      targetId: testReelId,
      reason: 'Inappropriate content',
      details: 'Duplicate attempt'
    });
  if (reportDuplicate.status !== 409) {
    throw new Error(`Expected HTTP 409 Conflict for duplicate report, got: ${reportDuplicate.status}`);
  }
  console.log('  ✓ Duplicate report prevented with HTTP 409 Conflict.');

  // Test 3: Reel "Not Interested" excludes from feed
  console.log('\n🚫 [3/7] Testing "Not Interested" Reel Exclusion...');
  // First approve the reel so it is eligible for feed
  await pool.query(`UPDATE reels SET status = 'APPROVED' WHERE id = $1`, [testReelId]);

  const notInterestedRes = await request(app)
    .post(`/api/reels/${testReelId}/not-interested`)
    .set('Authorization', `Bearer ${user1Token}`);
  if (notInterestedRes.status !== 200) {
    throw new Error(`Not-interested failed: ${notInterestedRes.status} ${JSON.stringify(notInterestedRes.body)}`);
  }
  console.log('  ✓ Reel marked as Not Interested for User1.');

  const forYouRes = await request(app)
    .get('/api/reels/foryou')
    .set('Authorization', `Bearer ${user1Token}`);
  const user1Reels = forYouRes.body.data as any[];
  const foundInFeed = user1Reels.some(r => r.id === testReelId);
  if (foundInFeed) {
    throw new Error(`Reel ${testReelId} was NOT excluded from user1 For You feed!`);
  }
  console.log('  ✓ Verified reel is completely excluded from User1 For You feed.');

  // Test 4: Admin Review Queue Bulk Moderation
  console.log('\n📦 [4/7] Testing Admin Review Queue Bulk Moderation...');
  // Create 2 new pending posts
  const p1 = await pool.query(
    `INSERT INTO posts (user_id, category_id, text_content, content_type, status)
     VALUES ($1, 2, 'Pending Bulk 1', 'TEXT', 'PENDING_REVIEW') RETURNING id`,
    [user2Id]
  );
  const p2 = await pool.query(
    `INSERT INTO posts (user_id, category_id, text_content, content_type, status)
     VALUES ($1, 2, 'Pending Bulk 2', 'TEXT', 'PENDING_REVIEW') RETURNING id`,
    [user2Id]
  );
  const post1Id = p1.rows[0].id;
  const post2Id = p2.rows[0].id;

  const bulkApproveRes = await request(app)
    .post('/api/admin/review-queue/bulk')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      action: 'APPROVE',
      items: [
        { id: post1Id, contentType: 'POST' },
        { id: post2Id, contentType: 'POST' }
      ],
      notes: 'Bulk approved in integration test'
    });

  if (bulkApproveRes.status !== 200 || bulkApproveRes.body.data?.successCount !== 2) {
    throw new Error(`Bulk approve failed: ${JSON.stringify(bulkApproveRes.body)}`);
  }
  console.log(`  ✓ Bulk Approved 2 items (successCount: ${bulkApproveRes.body.data.successCount}, failureCount: ${bulkApproveRes.body.data.failureCount}).`);

  // Test 5: User Moderation: Warn User
  console.log('\n⚠️ [5/7] Testing User Moderation: Warn User...');
  const warnRes = await request(app)
    .post(`/api/admin/users/${user2Id}/warn`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      reason: 'Inaccurate Hadith citation in submission',
      notes: 'Please reference Sahih Bukhari or Sahih Muslim strictly.'
    });
  if (warnRes.status !== 200) {
    throw new Error(`Warn user failed: ${warnRes.status} ${JSON.stringify(warnRes.body)}`);
  }
  console.log('  ✓ User warning issued successfully.');

  // Verify warning record and user details
  const userDetailsRes = await request(app)
    .get(`/api/admin/users/${user2Id}`)
    .set('Authorization', `Bearer ${adminToken}`);
  const warnings = userDetailsRes.body.data?.warnings;
  if (!warnings || warnings.length === 0 || warnings[0].reason !== 'Inaccurate Hadith citation in submission') {
    throw new Error(`Warning record missing from user details: ${JSON.stringify(warnings)}`);
  }
  console.log(`  ✓ Warning history verified in user details (${warnings.length} warning(s)).`);

  // Test 6: User Moderation: Suspend User with Duration
  console.log('\n⏳ [6/7] Testing User Moderation: Suspend with Duration...');
  const suspendRes = await request(app)
    .post(`/api/admin/users/${user2Id}/suspend`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      reason: 'Temporary suspension for repetitive guideline infractions',
      duration: '24h'
    });
  if (suspendRes.status !== 200) {
    throw new Error(`Suspend user failed: ${suspendRes.status} ${JSON.stringify(suspendRes.body)}`);
  }
  console.log('  ✓ User suspended for 24 hours.');

  // Verify suspended user is blocked from posting
  const blockedPostRes = await request(app)
    .post('/api/posts')
    .set('Authorization', `Bearer ${user2Token}`)
    .send({
      categoryId: 2,
      caption: 'Trying to post while suspended',
      contentType: 'POST',
      format: 'TEXT'
    });
  if (blockedPostRes.status !== 403) {
    throw new Error(`Suspended user should receive HTTP 403, got: ${blockedPostRes.status}`);
  }
  console.log('  ✓ Suspended user correctly blocked with HTTP 403.');

  // Test 7: User Moderation: Ban User (SUPER_ADMIN)
  console.log('\n⛔ [7/7] Testing User Moderation: Permanent Ban (SUPER_ADMIN)...');
  const banRes = await request(app)
    .post(`/api/admin/users/${user2Id}/ban`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      reason: 'Severe violation of platform terms'
    });
  if (banRes.status !== 200) {
    throw new Error(`Ban user failed: ${banRes.status} ${JSON.stringify(banRes.body)}`);
  }
  console.log('  ✓ User permanently banned by SUPER_ADMIN.');

  // Verify banned user cannot access protected endpoints
  const bannedAttempt = await request(app)
    .get('/api/auth/me')
    .set('Authorization', `Bearer ${user2Token}`);
  if (bannedAttempt.status !== 403) {
    throw new Error(`Banned user should receive HTTP 403, got: ${bannedAttempt.status}`);
  }
  console.log('  ✓ Banned user permanently blocked with HTTP 403.');

  console.log('\n================================================================');
  console.log('🎉 ALL ADVANCED FEATURES INTEGRATION TESTS PASSED (7/7)!');
  console.log('================================================================\n');

  process.exit(0);
}

runAdvancedFeaturesTest().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
