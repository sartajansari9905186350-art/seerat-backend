// verify_comment_edit_live.js
// Tests the live Render backend + PostgreSQL for comment editing and ownership validation

const BASE_URL = 'https://seerat-backend.onrender.com';

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function request(url, options = {}) {
  const res = await fetch(url, options);
  let json;
  try {
    json = await res.json();
  } catch (e) {
    json = null;
  }
  return { status: res.status, ok: res.ok, body: json };
}

async function main() {
  console.log('===========================================================');
  console.log('🧪 SEERAT EDIT COMMENT — BACKEND & POSTGRESQL VERIFICATION');
  console.log('Target:', BASE_URL);
  console.log('===========================================================\n');

  const ts = Date.now();

  // 1. Register User Alpha (Comment Owner)
  console.log('👤 [1/8] Registering User Alpha (Comment Owner)...');
  const userAlphaRes = await request(`${BASE_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Sartaj Alpha ${ts}`,
      username: `alpha_${ts}`,
      email: `alpha_${ts}@seerat.app`,
      password: 'StrongPassword123!',
      phone: `+91${Math.floor(1000000000 + Math.random() * 9000000000)}`
    })
  });

  if (!userAlphaRes.ok || !userAlphaRes.body?.data?.token) {
    throw new Error(`Alpha signup failed: status=${userAlphaRes.status} body=${JSON.stringify(userAlphaRes.body)}`);
  }
  const tokenAlpha = userAlphaRes.body.data.token;
  const userAlphaId = userAlphaRes.body.data.user.id;
  console.log(`  ✓ User Alpha registered: ID=${userAlphaId}`);

  // 2. Register User Beta (Other User / Attacker)
  console.log('\n👤 [2/8] Registering User Beta (Different User)...');
  const userBetaRes = await request(`${BASE_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Zayd Beta ${ts}`,
      username: `beta_${ts}`,
      email: `beta_${ts}@seerat.app`,
      password: 'StrongPassword123!',
      phone: `+91${Math.floor(1000000000 + Math.random() * 9000000000)}`
    })
  });

  if (!userBetaRes.ok || !userBetaRes.body?.data?.token) {
    throw new Error(`Beta signup failed: status=${userBetaRes.status} body=${JSON.stringify(userBetaRes.body)}`);
  }
  const tokenBeta = userBetaRes.body.data.token;
  const userBetaId = userBetaRes.body.data.user.id;
  console.log(`  ✓ User Beta registered: ID=${userBetaId}`);

  // 3. User Alpha creates a Post
  console.log('\n📝 [3/8] User Alpha creating test post...');
  const postRes = await request(`${BASE_URL}/api/posts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${tokenAlpha}`
    },
    body: JSON.stringify({
      categoryId: 1,
      contentType: 'TEXT',
      textContent: `Reflection post for comment edit testing at ${ts}`,
      language: 'en'
    })
  });

  if (!postRes.ok || !postRes.body?.data?.id) {
    throw new Error(`Create post failed: status=${postRes.status} body=${JSON.stringify(postRes.body)}`);
  }
  const postId = postRes.body.data.id;
  console.log(`  ✓ Post created: ID=${postId}`);

  // 4. User Alpha creates a Comment: "Test comment"
  console.log('\n💬 [4/8] User Alpha posting comment: "Test comment"...');
  const commentRes = await request(`${BASE_URL}/api/comments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${tokenAlpha}`
    },
    body: JSON.stringify({
      postId: postId,
      content: 'Test comment'
    })
  });

  if (commentRes.status !== 201 || !commentRes.body?.data?.id) {
    throw new Error(`Create comment failed: status=${commentRes.status} body=${JSON.stringify(commentRes.body)}`);
  }
  const commentId = commentRes.body.data.id;
  console.log(`  ✓ Comment created: ID=${commentId}, Content="${commentRes.body.data.content}"`);

  // 5. Security Test: User Beta attempts to edit User Alpha's comment
  console.log('\n🛡️ [5/8] Security Test: User Beta attempts to edit User Alpha\'s comment...');
  const unauthorizedEditRes = await request(`${BASE_URL}/api/comments/${commentId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${tokenBeta}`
    },
    body: JSON.stringify({
      content: 'Hacked comment by Beta'
    })
  });

  console.log(`  Response status: ${unauthorizedEditRes.status}`);
  console.log(`  Response message: ${unauthorizedEditRes.body?.message || unauthorizedEditRes.body?.error?.message}`);
  if (unauthorizedEditRes.status !== 403) {
    throw new Error(`Expected 403 FORBIDDEN, but got ${unauthorizedEditRes.status}! Ownership check failed!`);
  }
  console.log('  ✓ PASS: Ownership check successfully blocked User Beta (HTTP 403 Forbidden).');

  // 6. Validation Tests: Empty content & No auth
  console.log('\n⚠️ [6/8] Testing Validation: Empty content, No auth, and 404...');
  
  // 6a: Empty content
  const emptyEditRes = await request(`${BASE_URL}/api/comments/${commentId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${tokenAlpha}`
    },
    body: JSON.stringify({
      content: '   '
    })
  });
  if (emptyEditRes.status !== 400) {
    throw new Error(`Expected 400 for empty content, got ${emptyEditRes.status}`);
  }
  console.log('  ✓ PASS: Empty content rejected with HTTP 400.');

  // 6b: Missing auth
  const noAuthRes = await request(`${BASE_URL}/api/comments/${commentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'No auth test' })
  });
  if (noAuthRes.status !== 401) {
    throw new Error(`Expected 401 for unauthenticated request, got ${noAuthRes.status}`);
  }
  console.log('  ✓ PASS: Missing auth token rejected with HTTP 401.');

  // 6c: Non-existent comment
  const fakeId = '00000000-0000-0000-0000-000000000000';
  const notFoundRes = await request(`${BASE_URL}/api/comments/${fakeId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${tokenAlpha}`
    },
    body: JSON.stringify({ content: 'Not found test' })
  });
  if (notFoundRes.status !== 404) {
    throw new Error(`Expected 404 for non-existent comment, got ${notFoundRes.status}`);
  }
  console.log('  ✓ PASS: Non-existent comment rejected with HTTP 404.');

  // 7. Legitimate Edit: User Alpha edits to "Updated test comment"
  console.log('\n✏️ [7/8] Legitimate Edit: User Alpha editing to "Updated test comment"...');
  const validEditRes = await request(`${BASE_URL}/api/comments/${commentId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${tokenAlpha}`
    },
    body: JSON.stringify({
      content: 'Updated test comment'
    })
  });

  if (validEditRes.status !== 200 || !validEditRes.body?.data) {
    throw new Error(`Valid edit failed: status=${validEditRes.status} body=${JSON.stringify(validEditRes.body)}`);
  }
  const updatedCommentData = validEditRes.body.data;
  console.log(`  ✓ PATCH response status: ${validEditRes.status}`);
  console.log(`  ✓ Updated content: "${updatedCommentData.content}"`);
  console.log(`  ✓ Updated At: ${updatedCommentData.updated_at}`);

  if (updatedCommentData.content !== 'Updated test comment') {
    throw new Error(`Content mismatch in PATCH response: ${updatedCommentData.content}`);
  }

  // 8. Database Persistence Check: Query comments for post
  console.log('\n🔍 [8/8] Verifying Persistence from Database via GET /comments...');
  const getCommentsRes = await request(`${BASE_URL}/api/comments?postId=${postId}`, {
    headers: { 'Authorization': `Bearer ${tokenAlpha}` }
  });

  if (!getCommentsRes.ok || !Array.isArray(getCommentsRes.body?.data)) {
    throw new Error(`GET comments failed: status=${getCommentsRes.status} body=${JSON.stringify(getCommentsRes.body)}`);
  }

  const foundComment = getCommentsRes.body.data.find(c => c.id === commentId);
  if (!foundComment) {
    throw new Error(`Comment ${commentId} not found in database!`);
  }

  console.log(`  ✓ Retrieved comment from PostgreSQL:`);
  console.log(`    - ID: ${foundComment.id}`);
  console.log(`    - Content: "${foundComment.content}"`);
  console.log(`    - User Name: ${foundComment.user?.name}`);

  if (foundComment.content !== 'Updated test comment') {
    throw new Error(`FAIL: Database comment content is "${foundComment.content}", expected "Updated test comment"!`);
  }

  // 9. Clean up / Delete comment verification
  console.log('\n🗑️ [Bonus] Testing Delete Comment functionality...');
  const deleteRes = await request(`${BASE_URL}/api/comments/${commentId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${tokenAlpha}` }
  });

  if (deleteRes.status !== 200) {
    throw new Error(`Delete failed: status=${deleteRes.status}`);
  }
  console.log('  ✓ Comment deleted successfully (Delete functionality preserved).');

  console.log('\n===========================================================');
  console.log('🎉 ALL BACKEND & DATABASE VERIFICATION CHECKS PASSED 100%!');
  console.log('===========================================================');
}

main().catch(err => {
  console.error('\n❌ VERIFICATION FAILED:', err.message || err);
  process.exit(1);
});
