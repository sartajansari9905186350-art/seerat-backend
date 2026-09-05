const { query } = require('../dist/config/database');

async function testByteaSubstring() {
  try {
    const res = await query(`
      SELECT length(image_data) as total_len,
             length(substring(image_data from 1 for 100)) as slice_len
      FROM profile_photo_blobs
      LIMIT 1
    `);
    console.log('Query result:', res.rows);
  } catch (err) {
    console.error('Error:', err.message);
  }
}

testByteaSubstring().then(() => process.exit(0));
