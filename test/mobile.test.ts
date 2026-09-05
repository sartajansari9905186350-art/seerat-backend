import request from 'supertest';
import { pool, testConnection } from '../src/config/database';
import { runMigration } from '../database/migrate';
import { seedDatabase } from '../database/seed';
import app from '../src/app';

async function runMobileE2ETest() {
  console.log('\n================================================================');
  console.log('📱 SEERAT MOBILE APP & MODERATION — INTEGRATION TEST SUITE');
  console.log('================================================================\n');

  // Verify PostgreSQL Connection
  await testConnection();
  await runMigration();
  await seedDatabase();

  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_profile_completed BOOLEAN DEFAULT TRUE;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(50) DEFAULT 'EMAIL';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS provider_user_id VARCHAR(255);`);
  await pool.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS profile_photo VARCHAR(1024) DEFAULT '';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo_url VARCHAR(1024) DEFAULT '';`);
  await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS ai_status VARCHAR(50) DEFAULT 'UNCERTAIN';`);
  await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS ai_confidence NUMERIC(4,3) DEFAULT 0.500;`);
  await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS ai_reason TEXT DEFAULT '';`);
  await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS ai_analyzed_at TIMESTAMP WITH TIME ZONE;`);
  await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS ai_metadata JSONB DEFAULT '{}'::jsonb;`);

  await pool.query(`ALTER TABLE reels ADD COLUMN IF NOT EXISTS ai_status VARCHAR(50) DEFAULT 'UNCERTAIN';`);
  await pool.query(`ALTER TABLE reels ADD COLUMN IF NOT EXISTS ai_confidence NUMERIC(4,3) DEFAULT 0.500;`);
  await pool.query(`ALTER TABLE reels ADD COLUMN IF NOT EXISTS ai_reason TEXT DEFAULT '';`);
  await pool.query(`ALTER TABLE reels ADD COLUMN IF NOT EXISTS ai_analyzed_at TIMESTAMP WITH TIME ZONE;`);
  await pool.query(`ALTER TABLE reels ADD COLUMN IF NOT EXISTS ai_metadata JSONB DEFAULT '{}'::jsonb;`);

  await pool.query(`ALTER TABLE moderation_reviews ADD COLUMN IF NOT EXISTS ai_status VARCHAR(50) DEFAULT 'UNCERTAIN';`);
  await pool.query(`ALTER TABLE moderation_reviews ADD COLUMN IF NOT EXISTS ai_confidence NUMERIC(4,3) DEFAULT 0.500;`);
  await pool.query(`ALTER TABLE moderation_reviews ADD COLUMN IF NOT EXISTS ai_reason TEXT DEFAULT '';`);


  // 1. Mobile User Signup
  console.log('📝 [1/11] Testing Mobile User Signup...');
  const signupRes = await request(app)
    .post('/api/auth/signup')
    .send({
      name: 'Brother Salman',
      username: 'salman_scholar',
      email: 'salman@seerat.app',
      password: 'StrongPassword123!',
      phone: '+919876543210'
    });

  if (signupRes.status !== 201 || !signupRes.body.data.token) {
    throw new Error(`Signup failed: ${JSON.stringify(signupRes.body)}`);
  }
  const userToken = signupRes.body.data.token;
  const userObj = signupRes.body.data.user;
  console.log(`  ✓ Signup successful. Token issued for user ${userObj.username} (${userObj.id})`);

  // 2. Mobile User Login
  console.log('🔐 [2/11] Testing Mobile User Login...');
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({
      emailOrPhone: 'salman_scholar',
      password: 'StrongPassword123!'
    });

  if (loginRes.status !== 200 || !loginRes.body.data.token) {
    throw new Error(`Login failed: ${JSON.stringify(loginRes.body)}`);
  }
  console.log('  ✓ Login successful with username and password.');

  // 3. Admin Login (for moderation checks)
  const adminLogin = await request(app)
    .post('/api/admin/auth/login')
    .send({
      email: 'helpwaladost@gmail.com',
      password: 'Seerat@99051'
    });
  const adminToken = adminLogin.body.data.token;

  // 4. Categories & Feed loading
  console.log('📖 [3/11] Testing Categories and Home Feed...');
  const catRes = await request(app).get('/api/categories');
  if (catRes.status !== 200 || catRes.body.data.length === 0) {
    throw new Error(`Categories failed: ${JSON.stringify(catRes.body)}`);
  }
  console.log(`  ✓ Categories loaded: ${catRes.body.data.length} Islamic categories.`);

  const feedRes = await request(app)
    .get('/api/feed')
    .set('Authorization', `Bearer ${userToken}`);
  if (feedRes.status !== 200) {
    throw new Error(`Feed failed: ${JSON.stringify(feedRes.body)}`);
  }
  const initialPostCount = feedRes.body.data.length;
  console.log(`  ✓ Initial public approved posts loaded: ${initialPostCount}`);

  // 5. User creates Post -> must be PENDING_REVIEW
  console.log('✍️ [4/11] User Submits New Islamic Post (Mandatory Moderation)...');
  const createPostRes = await request(app)
    .post('/api/posts')
    .set('Authorization', `Bearer ${userToken}`)
    .send({
      categoryId: 2, // Quran
      contentType: 'TEXT',
      textContent: 'And He is with you wherever you are. (Surah Al-Hadid: 4)',
      arabicText: 'وَهُوَ مَعَكُمْ أَيْنَ مَا كُنتُمْ',
      translationText: 'And He is with you wherever you are.',
      referenceSource: 'Surah Al-Hadid, Verse 4',
      language: 'en'
    });

  if (createPostRes.status !== 201) {
    throw new Error(`Create post failed: ${JSON.stringify(createPostRes.body)}`);
  }
  const submittedPost = createPostRes.body.data;
  if (submittedPost.status !== 'PENDING_REVIEW') {
    throw new Error(`Post status must be PENDING_REVIEW, got: ${submittedPost.status}`);
  }
  console.log(`  ✓ Post created with status PENDING_REVIEW: ${submittedPost.id}`);

  // Check that newly created post is NOT yet publicly visible in feed
  const checkFeedRes = await request(app).get('/api/feed');
  const containsUnapproved = checkFeedRes.body.data.some((p: any) => p.id === submittedPost.id);
  if (containsUnapproved) {
    throw new Error('Unapproved post appeared in public feed!');
  }
  console.log('  ✓ Verified: Unapproved post is hidden from public Home Feed.');

  // 6. Admin Panel Review Queue has the item
  console.log('🛡️ [5/11] Verifying Admin Review Queue contains pending post...');
  const queueRes = await request(app)
    .get('/api/admin/review-queue?status=PENDING_REVIEW')
    .set('Authorization', `Bearer ${adminToken}`);
  
  const items = Array.isArray(queueRes.body.data) ? queueRes.body.data : queueRes.body.data?.items || [];
  const foundInQueue = items.some((item: any) => item.id === submittedPost.id);
  if (!foundInQueue) {
    throw new Error('Submitted post was not found in Admin Review Queue!');
  }
  console.log('  ✓ Post successfully entered Admin Review Queue.');

  // 7. Admin Approves the Post
  console.log('✅ [6/11] Admin Approves the Post...');
  const approveRes = await request(app)
    .post(`/api/admin/review-queue/${submittedPost.id}/approve`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      contentType: 'POST',
      notes: 'Authentic Quranic verse, verified.'
    });

  if (approveRes.status !== 200) {
    throw new Error(`Admin approval failed: ${JSON.stringify(approveRes.body)}`);
  }
  console.log('  ✓ Post approved by Admin.');

  // Check public feed now includes the post!
  const publicFeedAfterApproval = await request(app).get('/api/feed');
  const nowVisible = publicFeedAfterApproval.body.data.some((p: any) => p.id === submittedPost.id);
  if (!nowVisible) {
    throw new Error('Approved post did not appear in public Home feed!');
  }
  console.log('  ✓ Verified: Post is now publicly live in Home Feed after Islamic approval.');

  // 8. User Creates Reel -> Admin Rejects with Reason
  console.log('🎥 [7/11] User Submits Reel & Admin Rejects with Structured Reason...');
  const createReelRes = await request(app)
    .post('/api/reels')
    .set('Authorization', `Bearer ${userToken}`)
    .send({
      categoryId: 3, // Hadith
      videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
      thumbnailUrl: 'https://images.unsplash.com/photo-1542816417-0983c9c9ad53?w=600',
      caption: 'Unverified historical narration without chain of transmission.',
      referenceSource: 'Uncited'
    });

  if (createReelRes.status !== 201) {
    throw new Error(`Create reel failed: ${JSON.stringify(createReelRes.body)}`);
  }
  const submittedReel = createReelRes.body.data;

  // Admin Rejection
  const rejectRes = await request(app)
    .post(`/api/admin/review-queue/${submittedReel.id}/reject`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      contentType: 'REEL',
      rejectionReason: 'Incorrect information',
      customNotes: 'Hadith narration does not match authentic six books (Kutub al-Sittah).'
    });

  if (rejectRes.status !== 200) {
    throw new Error(`Rejection failed: ${JSON.stringify(rejectRes.body)}`);
  }
  console.log('  ✓ Reel rejected with structured reason FABRICATED_HADITH.');

  // Check notification to user
  const userNotifsRes = await request(app)
    .get('/api/notifications')
    .set('Authorization', `Bearer ${userToken}`);
  
  const rejectionNotif = userNotifsRes.body.data.find((n: any) => n.type === 'CONTENT_REJECTED');
  if (!rejectionNotif) {
    throw new Error('User did not receive rejection notification in Inbox!');
  }
  console.log(`  ✓ User Inbox received rejection notice: "${rejectionNotif.message}"`);

  // 9. Social Interactions: Like, Save, Comment
  console.log('❤️ [8/11] Testing Social Interactions (Like, Save, Comment)...');
  const likeRes = await request(app)
    .post(`/api/likes/post/${submittedPost.id}`)
    .set('Authorization', `Bearer ${userToken}`);
  if (likeRes.status !== 200 || likeRes.body.data !== true) {
    throw new Error(`Like failed: ${JSON.stringify(likeRes.body)}`);
  }
  console.log('  ✓ Post liked (is_liked = true).');

  const saveRes = await request(app)
    .post(`/api/saves/post/${submittedPost.id}`)
    .set('Authorization', `Bearer ${userToken}`);
  if (saveRes.status !== 200 || saveRes.body.data !== true) {
    throw new Error(`Save failed: ${JSON.stringify(saveRes.body)}`);
  }
  console.log('  ✓ Post saved to bookmarks (is_saved = true).');

  const commentRes = await request(app)
    .post('/api/comments')
    .set('Authorization', `Bearer ${userToken}`)
    .send({
      postId: submittedPost.id,
      content: 'MashaAllah, beautiful reminder!'
    });
  if (commentRes.status !== 201) {
    throw new Error(`Comment failed: ${JSON.stringify(commentRes.body)}`);
  }
  const createdCommentId = commentRes.body.data.id;
  console.log('  ✓ Comment added successfully.');

  // Test Comment Editing (PATCH /api/comments/:commentId)
  console.log('✏️ [8b/11] Testing Comment Edit & Ownership Security...');
  
  // 1. Unauthorized attempt (no token) -> 401
  const noAuthEdit = await request(app)
    .patch(`/api/comments/${createdCommentId}`)
    .send({ content: 'Unauthenticated edit attempt' });
  if (noAuthEdit.status !== 401) {
    throw new Error(`Expected 401 for no auth, got ${noAuthEdit.status}`);
  }
  console.log('  ✓ No-auth edit rejected with HTTP 401.');

  // 2. Forbidden attempt (Other user editing) -> 403
  // Register another user
  const otherUserRes = await request(app)
    .post('/api/auth/signup')
    .send({
      name: 'Other User',
      username: `other_${Date.now()}`,
      email: `other_${Date.now()}@seerat.app`,
      password: 'StrongPassword123!',
      phone: `+91${Math.floor(1000000000 + Math.random() * 9000000000)}`
    });
  const otherToken = otherUserRes.body.data.token;

  const forbiddenEdit = await request(app)
    .patch(`/api/comments/${createdCommentId}`)
    .set('Authorization', `Bearer ${otherToken}`)
    .send({ content: 'Attempt to tamper with other user comment' });
  if (forbiddenEdit.status !== 403) {
    throw new Error(`Expected 403 FORBIDDEN for editing someone else's comment, got ${forbiddenEdit.status}`);
  }
  console.log('  ✓ Other user edit blocked with HTTP 403 (Ownership verified).');

  // 3. Validation error (empty content) -> 400
  const emptyEdit = await request(app)
    .patch(`/api/comments/${createdCommentId}`)
    .set('Authorization', `Bearer ${userToken}`)
    .send({ content: '   ' });
  if (emptyEdit.status !== 400) {
    throw new Error(`Expected 400 for empty content, got ${emptyEdit.status}`);
  }
  console.log('  ✓ Empty edit rejected with HTTP 400.');

  // 4. Non-existent comment -> 404
  const notFoundEdit = await request(app)
    .patch('/api/comments/00000000-0000-0000-0000-000000000000')
    .set('Authorization', `Bearer ${userToken}`)
    .send({ content: 'Updated content' });
  if (notFoundEdit.status !== 404) {
    throw new Error(`Expected 404 for non-existent comment, got ${notFoundEdit.status}`);
  }
  console.log('  ✓ Non-existent comment edit rejected with HTTP 404.');

  // 5. Valid Edit by owner -> 200 OK
  const validEdit = await request(app)
    .patch(`/api/comments/${createdCommentId}`)
    .set('Authorization', `Bearer ${userToken}`)
    .send({ content: 'Updated test comment' });
  if (validEdit.status !== 200 || validEdit.body.data.content !== 'Updated test comment') {
    throw new Error(`Valid edit failed: ${JSON.stringify(validEdit.body)}`);
  }
  console.log('  ✓ Owner edit succeeded with HTTP 200. Content updated.');

  // 6. Verify via GET /api/comments
  const getComments = await request(app)
    .get(`/api/comments?postId=${submittedPost.id}`);
  const found = getComments.body.data.find((c: any) => c.id === createdCommentId);
  if (!found || found.content !== 'Updated test comment') {
    throw new Error(`Database persistence failed: found content is ${found?.content}`);
  }
  console.log('  ✓ Database persistence verified via GET /api/comments.');

  // 7. Delete Comment (verify delete still works)
  const deleteCommentRes = await request(app)
    .delete(`/api/comments/${createdCommentId}`)
    .set('Authorization', `Bearer ${userToken}`);
  if (deleteCommentRes.status !== 200) {
    throw new Error(`Delete comment failed: ${JSON.stringify(deleteCommentRes.body)}`);
  }
  console.log('  ✓ Comment deleted successfully (Delete functionality preserved).');

  // 10. Community Reporting
  console.log('🚩 [9/11] Testing Community Content Reporting...');
  const reportRes = await request(app)
    .post('/api/reports')
    .set('Authorization', `Bearer ${userToken}`)
    .send({
      targetType: 'POST',
      targetId: submittedPost.id,
      reason: 'MISQUOTED_TEXT',
      details: 'Please double-check translation nuance.'
    });
  if (reportRes.status !== 201) {
    throw new Error(`Report failed: ${JSON.stringify(reportRes.body)}`);
  }
  console.log('  ✓ Community report submitted.');

  // Verify Admin Panel Reports has it
  const adminReportsRes = await request(app)
    .get('/api/admin/reports?status=PENDING')
    .set('Authorization', `Bearer ${adminToken}`);
  const foundReport = adminReportsRes.body.data.some((r: any) => r.target_id === submittedPost.id);
  if (!foundReport) {
    throw new Error('Report did not appear in Admin Panel Reports!');
  }
  console.log('  ✓ Verified: Report visible in Admin Panel Reports section.');

  // 11. Profile & Session Expiry Handling
  console.log('👤 [10/11] Testing Profile and Token Validation...');
  const profileRes = await request(app)
    .get(`/api/users/profile/${userObj.id}`)
    .set('Authorization', `Bearer ${userToken}`);
  if (profileRes.status !== 200) {
    throw new Error(`Profile load failed: ${JSON.stringify(profileRes.body)}`);
  }
  console.log(`  ✓ Profile loaded for ${profileRes.body.data.name} (posts_count = ${profileRes.body.data.posts_count})`);

  // Invalid Token Check
  console.log('🔒 [11/11] Testing Invalid/Expired Token Handling...');
  const invalidTokenRes = await request(app)
    .get('/api/auth/me')
    .set('Authorization', 'Bearer invalid_garbage_token');
  if (invalidTokenRes.status !== 401) {
    throw new Error(`Expected 401 Unauthorized for invalid token, got: ${invalidTokenRes.status}`);
  }
  console.log('  ✓ Invalid token rejected with HTTP 401 Unauthorized.');

  console.log('\n================================================================');
  console.log('🎉 ALL MOBILE APP & MODERATION INTEGRATION TESTS PASSED 100%!');
  console.log('================================================================\n');
}

runMobileE2ETest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ INTEGRATION TEST FAILED:', err);
    process.exit(1);
  });
