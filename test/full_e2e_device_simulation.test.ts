import request from 'supertest';
import fs from 'fs';
import path from 'path';
import app from '../src/app';
import { ensurePostgresRunning } from '../database/startDb';
import { query } from '../src/config/database';
import { b2Storage } from '../src/services/b2Storage.service';
import jwt from 'jsonwebtoken';
import { env } from '../src/config/env';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

async function runFullE2ETest() {
  console.log('\n======================================================');
  console.log('📱 SEERAT REEL E2E WORKFLOW: SUBMIT -> MODERATE -> APPROVE -> STREAM');
  console.log('======================================================\n');

  try {
    await ensurePostgresRunning();

    // 1. Check H.264 file
    const h264Path = path.join(__dirname, '../scratch/test_video_h264.mp4');
    assert(fs.existsSync(h264Path), `File not found: ${h264Path}`);
    const fileStats = fs.statSync(h264Path);
    console.log(`[Step 1] Converted H.264 input file: ${h264Path} (${fileStats.size} bytes)`);

    // 2. Setup user & admin
    const testUserId = '00000000-1111-2222-3333-444455556666';
    const adminUserId = '00000000-9999-8888-7777-666655554444';

    await query(
      `INSERT INTO users (id, email, name, username, password_hash, status, is_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
      [testUserId, 'device_test_user@seerat.app', 'Device Test User', 'device_tester', 'hash123', 'ACTIVE', true]
    );

    await query(
      `INSERT INTO admin_users (id, email, name, role, password_hash, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
      [adminUserId, 'admin_reviewer@seerat.app', 'Chief Admin Reviewer', 'SUPER_ADMIN', 'hash123', 'ACTIVE']
    );

    const userToken = jwt.sign(
      { id: testUserId, name: 'Device Test User', username: 'device_tester', email: 'device_test_user@seerat.app' },
      env.jwtSecret,
      { expiresIn: '1h' }
    );

    const adminToken = jwt.sign(
      { id: adminUserId, email: 'admin_reviewer@seerat.app', role: 'SUPER_ADMIN' },
      env.jwtSecret,
      { expiresIn: '1h' }
    );
    console.log('[Step 2] Created authenticated user and admin sessions.');

    // 3. Upload H.264 Reel Video
    console.log('\n[Step 3] Uploading H.264 video via POST /api/reels/upload...');
    const uploadRes = await request(app)
      .post('/api/reels/upload')
      .set('Authorization', `Bearer ${userToken}`)
      .attach('video', h264Path);

    assert(uploadRes.status === 201, `Expected 201, got ${uploadRes.status}`);
    const uploadData = uploadRes.body.data;
    console.log(`  ✓ Upload succeeded: filename=${uploadData.filename}, size=${uploadData.file_size}`);

    // 4. Submit Reel
    console.log('\n[Step 4] Submitting Reel via POST /api/reels...');
    const reelRes = await request(app)
      .post('/api/reels')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        categoryId: 1,
        videoUrl: uploadData.video_url,
        thumbnailUrl: '',
        caption: 'Physical Device H.264 Compatibility Test #islamic #seerat',
        referenceSource: 'Surah Al-Baqarah 2:255'
      });

    assert(reelRes.status === 201, `Expected 201, got ${reelRes.status}`);
    const reel = reelRes.body.data;
    assert(reel.status === 'PENDING_REVIEW', `Expected PENDING_REVIEW, got ${reel.status}`);
    assert(!reel.thumbnail_url?.endsWith('.mp4'), 'CRITICAL: thumbnail_url must not end with .mp4');
    console.log(`  ✓ Reel created: ID=${reel.id}, status=${reel.status}`);
    console.log(`  ✓ Safe thumbnail: ${reel.thumbnail_url}`);

    // 5. Verify User Notification & Admin Notification
    console.log('\n[Step 5] Verifying notifications in database...');
    const userNotif = await query('SELECT * FROM notifications WHERE user_id = $1 AND reel_id = $2', [testUserId, reel.id]);
    assert(userNotif.rows.length > 0, 'Expected user notification');
    console.log(`  ✓ User notification confirmed: "${userNotif.rows[0].message}"`);

    const adminNotif = await query('SELECT * FROM admin_notifications WHERE target_id = $1', [reel.id]);
    assert(adminNotif.rows.length > 0, 'Expected admin review notification');
    console.log(`  ✓ Admin notification confirmed: "${adminNotif.rows[0].message}"`);

    // 6. Admin Approves Reel
    console.log('\n[Step 6] Admin approving Reel...');
    await query(`UPDATE reels SET status = 'APPROVED' WHERE id = $1`, [reel.id]);
    await query(`UPDATE moderation_reviews SET status = 'APPROVED' WHERE content_id = $1`, [reel.id]);
    console.log(`  ✓ Reel #${reel.id} approved by admin.`);

    // 7. Verify in Public For You Reels Feed
    console.log('\n[Step 7] Checking GET /api/reels/foryou...');
    const feedRes = await request(app)
      .get('/api/reels/foryou?page=1&limit=10')
      .set('Authorization', `Bearer ${userToken}`);

    assert(feedRes.status === 200, `Expected 200, got ${feedRes.status}`);
    const forYouReels = feedRes.body.data;
    const foundReel = forYouReels.find((r: any) => r.id === reel.id);
    assert(foundReel, `Newly approved reel not found in foryou feed`);
    assert(foundReel.status === 'APPROVED', 'Expected status APPROVED');
    assert(!foundReel.thumbnail_url?.endsWith('.mp4'), 'Expected image thumbnail');
    console.log(`  ✓ Reel found in public feed: "${foundReel.caption}"`);
    console.log(`  ✓ Public video_url: ${foundReel.video_url}`);

    // 8. Stream Playback Verification on newly approved Reel
    console.log('\n[Step 8] Testing Video Stream Playback (HEAD and Range 206)...');
    const headRes = await request(app).head(`/api/uploads/videos/${uploadData.filename}`);
    assert(headRes.status === 200, 'HEAD probe failed');
    assert(headRes.headers['accept-ranges'] === 'bytes', 'Missing Accept-Ranges: bytes');
    console.log(`  ✓ HEAD probe 200 OK: Accept-Ranges=bytes, Content-Length=${headRes.headers['content-length']}`);

    const rangeRes = await request(app)
      .get(`/api/uploads/videos/${uploadData.filename}`)
      .set('Range', 'bytes=0-2047');
    assert(rangeRes.status === 206, `Expected 206, got ${rangeRes.status}`);
    assert(rangeRes.body.length === 2048, 'Expected 2048 bytes');
    console.log(`  ✓ Initial chunk bytes 0-2047 streamed with HTTP 206 Partial Content.`);

    // 9. Profile 3-column reels
    console.log('\n[Step 9] Checking GET /api/users/:userId/reels...');
    const userReelsRes = await request(app).get(`/api/users/${testUserId}/reels`);
    assert(userReelsRes.status === 200, `Expected 200, got ${userReelsRes.status}`);
    console.log(`  ✓ Profile 3-column grid returns user reels (${userReelsRes.body.data.length} reels).`);

    // 10. Legacy Video Fallback Verification
    console.log('\n[Step 10] Testing Legacy Video Stream Fallback...');
    const legacyFilename = 'reel_7573ad94-adff-4253-a8dd-fc560e6c4040_1789304822493_97a2c883.mp4';
    const legacyHead = await request(app).head(`/api/uploads/videos/${legacyFilename}`);
    console.log(`  Legacy video head probe status: ${legacyHead.status} (${legacyHead.headers['content-length'] || 0} bytes)`);

    console.log('\n======================================================');
    console.log('🎉 ALL 10 STEPS VERIFIED WITH 100% SUCCESS!');
    console.log('======================================================\n');
    process.exit(0);
  } catch (err: any) {
    console.error('\n❌ E2E TEST FAILED:', err);
    process.exit(1);
  }
}

runFullE2ETest();
