const { query } = require('../dist/src/config/database');

async function inspect() {
  const reelId = 'f8ca1ab5-57b3-4c9b-b963-38b6232bc540';
  const reelRes = await query('SELECT * FROM reels WHERE id = $1', [reelId]);
  console.log('\n--- REEL DATABASE ROW ---');
  console.log(JSON.stringify(reelRes.rows[0], null, 2));

  const mediaRes = await query('SELECT * FROM media WHERE id = $1', [reelRes.rows[0].media_id]);
  console.log('\n--- MEDIA DATABASE ROW ---');
  console.log(JSON.stringify(mediaRes.rows[0], null, 2));

  const cols = await query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'reels' ORDER BY ordinal_position");
  console.log('\n--- REELS TABLE SCHEMA COLUMNS ---');
  cols.rows.forEach(c => console.log(`  ${c.column_name}: ${c.data_type}`));

  const modRes = await query('SELECT * FROM moderation_reviews WHERE content_id = $1 ORDER BY created_at DESC', [reelId]);
  console.log('\n--- MODERATION REVIEWS ROWS ---');
  console.log(JSON.stringify(modRes.rows, null, 2));

  process.exit(0);
}

inspect().catch(err => {
  console.error(err);
  process.exit(1);
});
