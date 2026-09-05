import { query } from '../src/config/database';

async function main() {
  const res = await query(`
    SELECT id, user_id, category, translation, reference, media_url, media_type, status, created_at 
    FROM posts 
    ORDER BY created_at DESC 
    LIMIT 5
  `);
  console.log('LATEST POSTS:', JSON.stringify(res.rows, null, 2));
  
  const updateRes = await query(`
    UPDATE posts 
    SET status = 'APPROVED' 
    WHERE status = 'PENDING_REVIEW'
  `);
  console.log(`Approved ${updateRes.rowCount} pending posts.`);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
