import request from 'supertest';
import app from '../src/app';
import { b2Storage } from '../src/services/b2Storage.service';
import { getDefaultThumbnailBuffer } from '../src/assets/defaultThumbnail';
import { ensurePostgresRunning } from '../database/startDb';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runB2Tests() {
  console.log('\n======================================================');
  console.log('🚀 SEERAT BACKBLAZE B2 & THUMBNAIL INTEGRATION TESTS');
  console.log('======================================================\n');

  try {
    await ensurePostgresRunning();
    // 1. Default PNG thumbnail binary generator
    console.log('[1/5] Testing Default PNG thumbnail binary generator...');
    const png = getDefaultThumbnailBuffer();
    assert(Buffer.isBuffer(png), 'Expected result to be a Buffer');
    assert(png.length > 100, `Expected PNG buffer length > 100, got ${png.length}`);
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert(png.subarray(0, 8).equals(pngHeader), 'Expected valid 8-byte PNG header');
    console.log(`  ✓ Generated valid PNG (${png.length} bytes) with correct signature.`);

    // 2. Health check endpoint B2 exposure
    console.log('[2/5] Testing /api/health endpoint safe operational status (no leaks)...');
    const healthRes = await request(app).get('/api/health');
    assert(healthRes.status === 200, `Expected 200, got ${healthRes.status}`);
    const data = healthRes.body?.data;
    assert(data && data.status === 'healthy', 'Expected status to be healthy');
    assert(data.database === 'connected', 'Expected database to be connected');
    assert(data.b2 && typeof data.b2.is_configured === 'boolean', 'Expected b2.is_configured boolean');
    assert(data.b2.bucket === 'seerat-media', 'Expected b2.bucket seerat-media');

    // Strict validation: Verify zero admin, account, or credential leakage
    assert(!('admin_accounts' in data), 'admin_accounts MUST NOT be in /api/health');
    assert(!('admins_count' in data), 'admins_count MUST NOT be in /api/health');
    assert(!('db_host' in data), 'db_host MUST NOT be in /api/health');
    assert(!('storage' in data), 'storage details MUST NOT be in /api/health');
    assert(!('ai' in data), 'ai details MUST NOT be in /api/health');
    assert(!('firebase' in data), 'firebase details MUST NOT be in /api/health');
    assert(!healthRes.text.includes('password'), 'Response text MUST NOT contain password');
    assert(!healthRes.text.includes('bcrypt'), 'Response text MUST NOT contain bcrypt');
    assert(!healthRes.text.includes('email'), 'Response text MUST NOT contain email');
    assert(!healthRes.text.includes('role'), 'Response text MUST NOT contain role');
    assert(!healthRes.text.includes('applicationKey'), 'Response text MUST NOT contain applicationKey');
    console.log(`  ✓ /api/health verified safe & clean:`, JSON.stringify(healthRes.body));

    // 3. /api/uploads/thumbnails/default.jpg returns 200 with image/png
    console.log('[3/5] Testing /api/uploads/thumbnails/default.jpg endpoint...');
    const thumbRes = await request(app).get('/api/uploads/thumbnails/default.jpg');
    assert(thumbRes.status === 200, `Expected 200, got ${thumbRes.status}`);
    assert(thumbRes.headers['content-type'].includes('image/png'), `Expected image/png, got ${thumbRes.headers['content-type']}`);
    assert(thumbRes.headers['cache-control'] !== undefined, 'Expected Cache-Control header');
    const thumbHeader = Buffer.from(thumbRes.body).subarray(0, 8);
    assert(thumbHeader.equals(pngHeader), 'Served thumbnail has valid PNG signature');
    console.log(`  ✓ /api/uploads/thumbnails/default.jpg returned 200 image/png (${thumbRes.body.length} bytes).`);

    // 4. /api/uploads/thumbnails/:any_missing.jpg gracefully returns default PNG
    console.log('[4/5] Testing thumbnail fallback on missing/custom filename...');
    const missingThumbRes = await request(app).get('/api/uploads/thumbnails/sample_missing_thumb.jpg');
    assert(missingThumbRes.status === 200, `Expected 200, got ${missingThumbRes.status}`);
    assert(missingThumbRes.headers['content-type'].includes('image/png'), `Expected image/png on fallback, got ${missingThumbRes.headers['content-type']}`);
    console.log(`  ✓ Missing thumbnail correctly fell back to default PNG with 200 OK.`);

    // 5. B2 storage service unconfigured graceful behavior
    console.log('[5/5] Testing B2StorageService safe unconfigured behavior...');
    const configured = b2Storage.isConfigured();
    console.log(`  - Current test environment B2 configured: ${configured}`);
    if (!configured) {
      const exists = await b2Storage.hasObject('videos/test.mp4');
      assert(exists === false, 'Expected hasObject to return false when unconfigured');
      const meta = await b2Storage.getObjectMetadata('videos/test.mp4');
      assert(meta === null, 'Expected getObjectMetadata to return null when unconfigured');
      const mockRes: any = { headersSent: false, status: () => mockRes, json: () => mockRes };
      const streamResult = await b2Storage.streamObject('videos/test.mp4', undefined, mockRes);
      assert(streamResult === false, 'Expected streamObject to return false when unconfigured');
      console.log('  ✓ Safe fallback verified: all B2 methods return null/false when unconfigured.');
    } else {
      console.log('  ✓ B2 is configured in environment.');
    }

    console.log('\n======================================================');
    console.log('🎉 ALL B2 INTEGRATION TESTS PASSED SUCCESSFULLY');
    console.log('======================================================\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ B2 INTEGRATION TEST FAILED:', error);
    process.exit(1);
  }
}

runB2Tests();
