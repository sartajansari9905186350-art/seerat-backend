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

async function runH264CompatibilityTests() {
  console.log('\n======================================================');
  console.log('🎥 UNIVERSAL H.264 / AAC VIDEO UPLOAD & PLAYBACK TEST');
  console.log('======================================================\n');

  try {
    await ensurePostgresRunning();

    await query(`
      CREATE TABLE IF NOT EXISTS video_blobs (
        id UUID PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        mime_type VARCHAR(50),
        file_size BIGINT,
        video_data BYTEA,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // 1. Locate test converted H.264 file
    const h264FilePath = path.join(__dirname, '../scratch/test_video_h264.mp4');
    assert(fs.existsSync(h264FilePath), `H.264 test file not found at ${h264FilePath}`);
    const fileStats = fs.statSync(h264FilePath);
    console.log(`[Input] Converted H.264 video: ${h264FilePath}`);
    console.log(`  File size: ${(fileStats.size / (1024 * 1024)).toFixed(2)} MB (${fileStats.size} bytes)`);

    // 2. Setup authenticated test user and JWT token
    const testUserId = '00000000-1111-2222-3333-444455556666';
    await query(
      `INSERT INTO users (id, email, name, username, password_hash, status, is_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
      [testUserId, 'h264_tester@seerat.app', 'H264 Test User', 'h264_tester', 'hash123', 'ACTIVE', true]
    );

    const authToken = jwt.sign(
      { id: testUserId, name: 'H264 Test User', username: 'h264_tester', email: 'h264_tester@seerat.app' },
      env.jwtSecret,
      { expiresIn: '1h' }
    );
    console.log('  ✓ Authenticated test user session created.');

    // 3. Upload converted H.264 file via /api/reels/upload multipart
    console.log('\n[1/5] Testing /api/reels/upload with converted H.264 video...');
    const uploadRes = await request(app)
      .post('/api/reels/upload')
      .set('Authorization', `Bearer ${authToken}`)
      .attach('video', h264FilePath);

    assert(uploadRes.status === 201, `Expected 201, got ${uploadRes.status}: ${JSON.stringify(uploadRes.body)}`);
    assert(uploadRes.body.success === true, 'Expected upload success: true');
    const uploadData = uploadRes.body.data;
    assert(uploadData.video_url, 'Expected valid video_url in response');
    assert(uploadData.filename, 'Expected valid filename in response');
    assert(uploadData.file_size === fileStats.size, `Expected file_size ${fileStats.size}, got ${uploadData.file_size}`);
    assert(uploadData.mime_type === 'video/mp4', `Expected mime_type video/mp4, got ${uploadData.mime_type}`);

    console.log(`  ✓ Video uploaded successfully: ${uploadData.filename}`);
    console.log(`  ✓ Returned video_url: ${uploadData.video_url}`);
    console.log(`  ✓ B2 configured status: ${b2Storage.isConfigured()}`);

    // 4. Test HEAD request on the uploaded video
    console.log('\n[2/5] Testing HEAD /api/uploads/videos/:filename (Fast Probe)...');
    const headRes = await request(app).head(`/api/uploads/videos/${uploadData.filename}`);
    assert(headRes.status === 200, `Expected 200, got ${headRes.status}`);
    assert(headRes.headers['accept-ranges'] === 'bytes', 'Expected Accept-Ranges: bytes');
    assert(headRes.headers['content-type'].includes('video/mp4'), 'Expected Content-Type: video/mp4');
    assert(parseInt(headRes.headers['content-length'], 10) === fileStats.size, 'Expected full Content-Length');
    console.log('  ✓ HEAD request returns 200 with Accept-Ranges: bytes and exact Content-Length.');

    // 5. Test Range Request for ExoPlayer / Chrome Initial Probe (bytes 0-1023)
    console.log('\n[3/5] Testing Range bytes=0-1023 (ExoPlayer/Chrome initial probe)...');
    const range1 = await request(app)
      .get(`/api/uploads/videos/${uploadData.filename}`)
      .set('Range', 'bytes=0-1023');

    assert(range1.status === 206, `Expected 206 Partial Content, got ${range1.status}`);
    assert(range1.headers['content-range'] === `bytes 0-1023/${fileStats.size}`, `Got Content-Range: ${range1.headers['content-range']}`);
    assert(range1.headers['content-length'] === '1024', `Expected length 1024, got ${range1.headers['content-length']}`);
    assert(range1.body.length === 1024, `Expected 1024 bytes body, got ${range1.body.length}`);

    // Verify MP4 ftyp box signature in the first 8 bytes (bytes 4..7 === 'ftyp')
    const ftypSig = range1.body.slice(4, 8).toString('ascii');
    assert(ftypSig === 'ftyp', `Expected MP4 ftyp box, got '${ftypSig}'`);
    console.log(`  ✓ Initial chunk bytes=0-1023 returned 206 with authentic MP4 '${ftypSig}' header.`);

    // 6. Test Subsequent Range Request (bytes 1048576-2097151 - 1 MB chunk at 1MB offset)
    console.log('\n[4/5] Testing Seeking/Buffering Range bytes=1048576-2097151 (1 MB chunk)...');
    const range2 = await request(app)
      .get(`/api/uploads/videos/${uploadData.filename}`)
      .set('Range', 'bytes=1048576-2097151');

    assert(range2.status === 206, `Expected 206 Partial Content, got ${range2.status}`);
    assert(range2.headers['content-range'] === `bytes 1048576-2097151/${fileStats.size}`, `Got Content-Range: ${range2.headers['content-range']}`);
    assert(range2.headers['content-length'] === '1048576', `Expected 1MB chunk length, got ${range2.headers['content-length']}`);
    assert(range2.body.length === 1048576, `Expected 1MB body length, got ${range2.body.length}`);
    console.log('  ✓ Mid-stream Range request returned exactly 1 MB chunk with HTTP 206.');

    // 7. Test Reel Creation with AI Moderation & Thumbnail Protection
    console.log('\n[5/5] Testing Reel Creation with AI Moderation...');
    const reelRes = await request(app)
      .post('/api/reels')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        categoryId: 1,
        videoUrl: uploadData.video_url,
        thumbnailUrl: '', // Should fallback to default thumbnail, NEVER an MP4
        caption: 'Beautiful Islamic Reminder on Taqwa #islamic #taqwa',
        referenceSource: 'Surah Al-Imran 3:102'
      });

    assert(reelRes.status === 201, `Expected 201, got ${reelRes.status}: ${JSON.stringify(reelRes.body)}`);
    const createdReel = reelRes.body.data;
    assert(createdReel.video_url === uploadData.video_url, 'Expected correct video_url');
    assert(!createdReel.thumbnail_url?.endsWith('.mp4'), 'CRITICAL: thumbnail_url must NEVER end with .mp4');
    console.log(`  ✓ Reel created with ID: ${createdReel.id}`);
    console.log(`  ✓ Status: ${createdReel.status}`);
    console.log(`  ✓ Thumbnail URL: ${createdReel.thumbnail_url}`);

    console.log('\n======================================================');
    console.log('🎉 ALL H.264 COMPATIBILITY & STREAMING TESTS PASSED 100%');
    console.log('======================================================\n');
    process.exit(0);
  } catch (err: any) {
    console.error('\n❌ H.264 COMPATIBILITY TEST FAILED:', err);
    process.exit(1);
  }
}

runH264CompatibilityTests();
