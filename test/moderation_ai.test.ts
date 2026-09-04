import request from 'supertest';
import app from '../src/app';
import { aiModerationService } from '../src/services/aiModeration.service';
import { pool, query } from '../src/config/database';
import { ensurePostgresRunning } from '../database/startDb';
import jwt from 'jsonwebtoken';
import { env } from '../src/config/env';
import { v4 as uuidv4 } from 'uuid';

async function runModerationAiTests() {
  console.log('\n======================================================');
  console.log('🤖 SEERAT AI ISLAMIC CONTENT MODERATION TEST SUITE');
  console.log('======================================================\n');

  try {
    await ensurePostgresRunning();

    // Setup Admin and User test tokens
    const testAdminId = uuidv4();
    const testUserId = uuidv4();
    const testUsername = `creator_${Date.now()}`;
    const testEmail = `${testUsername}@seerat.test`;

    const adminToken = jwt.sign(
      { id: testAdminId, name: 'Theological Moderator', email: 'mod@seerat.app', role: 'MODERATOR' },
      env.jwtSecret,
      { expiresIn: '1h' }
    );

    const userToken = jwt.sign(
      { id: testUserId, name: 'Test Muslim Creator', username: testUsername },
      env.jwtSecret,
      { expiresIn: '1h' }
    );

    // Ensure AI columns exist in PostgreSQL
    await query(`
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS ai_status VARCHAR(50) DEFAULT 'UNCERTAIN';
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS ai_confidence NUMERIC(4,3) DEFAULT 0.500;
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS ai_reason TEXT DEFAULT '';
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS ai_analyzed_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS ai_metadata JSONB DEFAULT '{}'::jsonb;

      ALTER TABLE reels ADD COLUMN IF NOT EXISTS ai_status VARCHAR(50) DEFAULT 'UNCERTAIN';
      ALTER TABLE reels ADD COLUMN IF NOT EXISTS ai_confidence NUMERIC(4,3) DEFAULT 0.500;
      ALTER TABLE reels ADD COLUMN IF NOT EXISTS ai_reason TEXT DEFAULT '';
      ALTER TABLE reels ADD COLUMN IF NOT EXISTS ai_analyzed_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE reels ADD COLUMN IF NOT EXISTS ai_metadata JSONB DEFAULT '{}'::jsonb;

      ALTER TABLE moderation_reviews ADD COLUMN IF NOT EXISTS ai_status VARCHAR(50) DEFAULT 'UNCERTAIN';
      ALTER TABLE moderation_reviews ADD COLUMN IF NOT EXISTS ai_confidence NUMERIC(4,3) DEFAULT 0.500;
      ALTER TABLE moderation_reviews ADD COLUMN IF NOT EXISTS ai_reason TEXT DEFAULT '';
    `);

    // Ensure test admin exists in DB
    const testAdminEmail = `mod_${Date.now()}@seerat.test`;
    await query(
      `INSERT INTO admin_users (id, name, email, password_hash, role, status)
       VALUES ($1, 'Theological Moderator', $2, 'fakehash', 'MODERATOR', 'ACTIVE')
       ON CONFLICT (id) DO NOTHING`,
      [testAdminId, testAdminEmail]
    );

    // Ensure test user exists in DB
    await query(
      `INSERT INTO users (id, name, username, email, password_hash, status)
       VALUES ($1, 'Test Muslim Creator', $2, $3, 'fakehash', 'ACTIVE')
       ON CONFLICT (id) DO NOTHING`,
      [testUserId, testUsername, testEmail]
    );
    await query(
      `INSERT INTO profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
      [testUserId]
    );

    // -------------------------------------------------------------
    // Test 1: Authentic Islamic Quran & Hadith content -> LIKELY_ISLAMIC
    // -------------------------------------------------------------
    console.log('[1/9] Testing AI classification for authentic Islamic content...');
    const islamicResult = await aiModerationService.screenContent({
      contentType: 'POST',
      contentId: uuidv4(),
      textContent: 'SubhanAllah! Beautiful recitation of Surah Al-Baqarah Ayah 255 (Ayat al-Kursi). Let us remember Allah in all circumstances.',
      referenceSource: 'Quran 2:255',
      arabicText: 'اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ'
    });

    if (islamicResult.ai_status !== 'LIKELY_ISLAMIC' || islamicResult.ai_confidence < 0.80) {
      throw new Error(`Expected LIKELY_ISLAMIC with >0.80 confidence, got ${islamicResult.ai_status} (${islamicResult.ai_confidence})`);
    }
    console.log(`  ✓ Classified as ${islamicResult.ai_status} (Confidence: ${(islamicResult.ai_confidence * 100).toFixed(1)}%). Reason: ${islamicResult.ai_reason}`);

    // -------------------------------------------------------------
    // Test 2: Commercial & Secular Spam -> LIKELY_NON_ISLAMIC
    // -------------------------------------------------------------
    console.log('\n[2/9] Testing AI classification for non-Islamic commercial spam...');
    const spamResult = await aiModerationService.screenContent({
      contentType: 'POST',
      contentId: uuidv4(),
      textContent: 'Buy now with 50% discount code! Shop online for luxury watches. Limited offer and free shipping available!'
    });

    if (spamResult.ai_status !== 'LIKELY_NON_ISLAMIC') {
      throw new Error(`Expected LIKELY_NON_ISLAMIC, got ${spamResult.ai_status}`);
    }
    console.log(`  ✓ Classified as ${spamResult.ai_status} (Confidence: ${(spamResult.ai_confidence * 100).toFixed(1)}%).`);

    // -------------------------------------------------------------
    // Test 3: Prohibited Unsafe Content -> UNSAFE
    // -------------------------------------------------------------
    console.log('\n[3/9] Testing AI classification for prohibited unsafe content...');
    const unsafeResult = await aiModerationService.screenContent({
      contentType: 'POST',
      contentId: uuidv4(),
      textContent: 'Join our casino night with free alcohol and poker betting! Win cash fast at the slot machines!'
    });

    if (unsafeResult.ai_status !== 'UNSAFE') {
      throw new Error(`Expected UNSAFE, got ${unsafeResult.ai_status}`);
    }
    console.log(`  ✓ Classified as ${unsafeResult.ai_status} (Confidence: ${(unsafeResult.ai_confidence * 100).toFixed(1)}%).`);

    // -------------------------------------------------------------
    // Test 4: Ambiguous/Sparse Text -> UNCERTAIN
    // -------------------------------------------------------------
    console.log('\n[4/9] Testing AI classification for ambiguous content (falls back to UNCERTAIN)...');
    const uncertainResult = await aiModerationService.screenContent({
      contentType: 'POST',
      contentId: uuidv4(),
      textContent: 'Good morning everyone, wishing you a pleasant and sunny day.'
    });

    if (uncertainResult.ai_status !== 'UNCERTAIN') {
      throw new Error(`Expected UNCERTAIN, got ${uncertainResult.ai_status}`);
    }
    console.log(`  ✓ Classified as ${uncertainResult.ai_status} (Advisory human review required).`);

    // -------------------------------------------------------------
    // Test 5: Strict PENDING_REVIEW Guarantee (AI Never Publishes)
    // -------------------------------------------------------------
    console.log('\n[5/9] Testing Strict PENDING_REVIEW Guarantee upon Post creation...');
    const postRes = await request(app)
      .post('/api/posts')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        categoryId: 1,
        contentType: 'TEXT',
        textContent: 'The Prophet Muhammad (peace be upon him) said: Convey from me even if just one ayah.',
        referenceSource: 'Sahih Bukhari 3461'
      });

    if (postRes.status !== 201 || !postRes.body.success) {
      throw new Error(`Post creation failed with status ${postRes.status}: ${JSON.stringify(postRes.body)}`);
    }

    const createdPostId = postRes.body.data.id;
    if (postRes.body.data.status !== 'PENDING_REVIEW') {
      throw new Error(`CRITICAL SECURITY FAILURE: Status was ${postRes.body.data.status}, MUST BE PENDING_REVIEW`);
    }

    const dbPostCheck = await query('SELECT status, ai_status, ai_confidence FROM posts WHERE id = $1', [createdPostId]);
    if (dbPostCheck.rows[0].status !== 'PENDING_REVIEW') {
      throw new Error(`Database record status is ${dbPostCheck.rows[0].status}, expected PENDING_REVIEW`);
    }
    console.log(`  ✓ Post strictly retained as PENDING_REVIEW with AI tag: ${dbPostCheck.rows[0].ai_status}.`);

    // -------------------------------------------------------------
    // Test 6: Admin Review Queue Fetch with AI Screening Metadata
    // -------------------------------------------------------------
    console.log('\n[6/9] Fetching Admin Review Queue with AI metadata...');
    const queueRes = await request(app)
      .get('/api/admin/review-queue?status=PENDING_REVIEW')
      .set('Authorization', `Bearer ${adminToken}`);

    if (queueRes.status !== 200 || !queueRes.body.success) {
      throw new Error(`Failed to fetch review queue: ${queueRes.status}`);
    }
    const targetItem = queueRes.body.data.find((item: any) => item.id === createdPostId);
    if (!targetItem) {
      throw new Error(`Newly created post #${createdPostId} not found in review queue`);
    }
    if (!targetItem.ai_status) {
      throw new Error(`Review queue item missing ai_status field: ${JSON.stringify(targetItem)}`);
    }
    console.log(`  ✓ Queue item contains ai_status: ${targetItem.ai_status} and creator: ${targetItem.creator_name}`);

    // -------------------------------------------------------------
    // Test 7: Flag / Senior Review Action
    // -------------------------------------------------------------
    console.log('\n[7/9] Testing Admin Flag / Senior Theological Review action...');
    const flagRes = await request(app)
      .post(`/api/admin/review-queue/${createdPostId}/flag`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        contentType: 'POST',
        notes: 'Flagged for senior theological scholar review on Hadith authentication.'
      });

    if (flagRes.status !== 200 || flagRes.body?.data?.status !== 'FLAGGED') {
      throw new Error(`Flag action failed: ${flagRes.status} ${JSON.stringify(flagRes.body)}`);
    }

    const dbFlagCheck = await query('SELECT status, rejection_reason FROM posts WHERE id = $1', [createdPostId]);
    if (dbFlagCheck.rows[0].status !== 'FLAGGED') {
      throw new Error(`Post status not updated to FLAGGED in database: ${dbFlagCheck.rows[0].status}`);
    }

    const auditFlagCheck = await query(
      `SELECT action, target_id FROM admin_audit_logs WHERE target_id = $1 AND action = 'FLAGGED_CONTENT'`,
      [createdPostId]
    );
    if (auditFlagCheck.rows.length === 0) {
      throw new Error('Audit log for FLAGGED_CONTENT was not recorded');
    }
    console.log('  ✓ Content successfully moved to FLAGGED with immutable audit log.');

    // -------------------------------------------------------------
    // Test 8: Admin Approve and Publish Action
    // -------------------------------------------------------------
    console.log('\n[8/9] Testing Admin Approve and Publish action...');
    const approveRes = await request(app)
      .post(`/api/admin/review-queue/${createdPostId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        contentType: 'POST',
        notes: 'Verified against authentic source and approved.'
      });

    if (approveRes.status !== 200 || approveRes.body?.data?.status !== 'APPROVED') {
      throw new Error(`Approve action failed: ${approveRes.status} ${JSON.stringify(approveRes.body)}`);
    }

    const dbApproveCheck = await query('SELECT status FROM posts WHERE id = $1', [createdPostId]);
    if (dbApproveCheck.rows[0].status !== 'APPROVED') {
      throw new Error(`Post status not updated to APPROVED in database: ${dbApproveCheck.rows[0].status}`);
    }
    console.log('  ✓ Content approved and published successfully.');

    // -------------------------------------------------------------
    // Test 9: RBAC & Security Enforcement
    // -------------------------------------------------------------
    console.log('\n[9/9] Testing RBAC security boundaries...');
    const unauthRes = await request(app)
      .post(`/api/admin/review-queue/${createdPostId}/flag`)
      .send({ contentType: 'POST' });

    if (unauthRes.status !== 401) {
      throw new Error(`Expected 401 for unauthenticated request, got ${unauthRes.status}`);
    }

    const regularUserRes = await request(app)
      .post(`/api/admin/review-queue/${createdPostId}/flag`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ contentType: 'POST' });

    if (regularUserRes.status !== 403) {
      throw new Error(`Expected 403 for regular user token, got ${regularUserRes.status}`);
    }
    console.log('  ✓ Unauthorized access blocked with 401; non-admin blocked with 403.');

    console.log('\n======================================================');
    console.log('✅ ALL 9 AI MODERATION & REVIEW TESTS PASSED');
    console.log('======================================================\n');
    process.exit(0);

  } catch (err: any) {
    console.error('\n❌ TEST FAILED:', err.message);
    process.exit(1);
  } finally {
    try {
      await pool.end();
    } catch {}
  }
}

runModerationAiTests();
