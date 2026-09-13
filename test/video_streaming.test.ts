import request from 'supertest';
import app from '../src/app';
import { ensurePostgresRunning } from '../database/startDb';
import { query } from '../src/config/database';
import { v4 as uuidv4 } from 'uuid';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

async function runVideoStreamingTests() {
  console.log('\n======================================================');
  console.log('🎥 SEERAT VIDEO STREAMING & RANGE VERIFICATION TESTS');
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

    // Insert dummy video blob in postgres for fallback verification
    const testFilename = `test_stream_${Date.now()}.mp4`;
    const dummyData = Buffer.alloc(100000, 0xAA); // 100,000 bytes
    await query(
      `INSERT INTO video_blobs (id, filename, mime_type, file_size, video_data)
       VALUES ($1, $2, $3, $4, $5)`,
      [uuidv4(), testFilename, 'video/mp4', dummyData.length, dummyData]
    );
    console.log(`[Setup] Inserted test video blob (${dummyData.length} bytes): ${testFilename}`);

    // 1. HEAD request test
    console.log('[1/4] Testing HEAD /api/uploads/videos/:filename...');
    const headRes = await request(app).head(`/api/uploads/videos/${testFilename}`);
    assert(headRes.status === 200, `Expected 200, got ${headRes.status}`);
    assert(headRes.headers['accept-ranges'] === 'bytes', 'Expected Accept-Ranges: bytes');
    assert(headRes.headers['content-type'].includes('video/mp4'), 'Expected Content-Type: video/mp4');
    assert(headRes.headers['content-length'] === '100000', `Expected length 100000, got ${headRes.headers['content-length']}`);
    console.log('  ✓ HEAD request returned 200 with correct probe headers.');

    // 2. Range request bytes=0-999 (First chunk)
    console.log('[2/4] Testing GET Range bytes=0-999 (206 Partial Content)...');
    const range1 = await request(app)
      .get(`/api/uploads/videos/${testFilename}`)
      .set('Range', 'bytes=0-999');
    assert(range1.status === 206, `Expected 206, got ${range1.status}`);
    assert(range1.headers['content-range'] === 'bytes 0-999/100000', `Expected bytes 0-999/100000, got ${range1.headers['content-range']}`);
    assert(range1.headers['content-length'] === '1000', `Expected length 1000, got ${range1.headers['content-length']}`);
    assert(range1.body.length === 1000, `Expected 1000 bytes, got ${range1.body.length}`);
    console.log('  ✓ Range 0-999 returned HTTP 206 with correct Content-Range and length.');

    // 3. Middle range request bytes=50000-50999
    console.log('[3/4] Testing GET Range bytes=50000-50999...');
    const range2 = await request(app)
      .get(`/api/uploads/videos/${testFilename}`)
      .set('Range', 'bytes=50000-50999');
    assert(range2.status === 206, `Expected 206, got ${range2.status}`);
    assert(range2.headers['content-range'] === 'bytes 50000-50999/100000', `Got ${range2.headers['content-range']}`);
    assert(range2.body.length === 1000, `Expected 1000 bytes, got ${range2.body.length}`);
    console.log('  ✓ Middle range request verified.');

    // 4. Invalid range request bytes=100000- (past end)
    console.log('[4/4] Testing GET Invalid Range bytes=100000- (416 Range Not Satisfiable)...');
    const rangeErr = await request(app)
      .get(`/api/uploads/videos/${testFilename}`)
      .set('Range', 'bytes=100000-');
    assert(rangeErr.status === 416, `Expected 416, got ${rangeErr.status}`);
    assert(rangeErr.headers['content-range'] === 'bytes */100000', `Expected bytes */100000, got ${rangeErr.headers['content-range']}`);
    console.log('  ✓ Out-of-bounds range returned HTTP 416 correctly.');

    // Cleanup
    await query('DELETE FROM video_blobs WHERE filename = $1', [testFilename]);
    console.log('  ✓ Cleaned up test record.');

    console.log('\n======================================================');
    console.log('🎉 ALL VIDEO STREAMING & RANGE TESTS PASSED 100%');
    console.log('======================================================\n');
    process.exit(0);
  } catch (err: any) {
    console.error('\n❌ VIDEO STREAMING TEST FAILED:', err);
    process.exit(1);
  }
}

runVideoStreamingTests();
