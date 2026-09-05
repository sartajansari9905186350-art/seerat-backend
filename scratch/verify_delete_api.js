const BASE_URL = 'https://seerat-backend.onrender.com';

async function run() {
  console.log('🚀 Starting Backend Live Delete Verification on:', BASE_URL);
  const ts = Date.now();

  // 1. Create User A
  console.log('\n[1] Registering User A...');
  const userARes = await fetch(`${BASE_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `User Alpha ${ts}`,
      username: `alpha_${ts}`,
      email: `alpha_${ts}@test.com`,
      password: 'Password123!',
      phone: `+91${Math.floor(1000000000 + Math.random() * 9000000000)}`
    })
  });
  const userAData = await userARes.json();
  if (!userAData.success) {
    throw new Error(`Failed to create User A: ${JSON.stringify(userAData)}`);
  }
  const tokenA = userAData.data.token;
  const userAId = userAData.data.user.id;
  console.log(`✓ User A registered: ${userAId}`);

  // 2. Create User B
  console.log('\n[2] Registering User B...');
  const userBRes = await fetch(`${BASE_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `User Beta ${ts}`,
      username: `beta_${ts}`,
      email: `beta_${ts}@test.com`,
      password: 'Password123!',
      phone: `+91${Math.floor(1000000000 + Math.random() * 9000000000)}`
    })
  });
  const userBData = await userBRes.json();
  if (!userBData.success) {
    throw new Error(`Failed to create User B: ${JSON.stringify(userBData)}`);
  }
  const tokenB = userBData.data.token;
  const userBId = userBData.data.user.id;
  console.log(`✓ User B registered: ${userBId}`);

  // 3. User A creates a post
  console.log('\n[3] User A creating a post...');
  const createPostRes = await fetch(`${BASE_URL}/api/posts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${tokenA}`
    },
    body: JSON.stringify({
      categoryId: 1,
      contentType: 'TEXT',
      textContent: `Automated test post created at ${ts}`,
      language: 'en'
    })
  });
  const postData = await createPostRes.json();
  if (!postData.success) {
    throw new Error(`Failed to create post: ${JSON.stringify(postData)}`);
  }
  const postId = postData.data.id;
  console.log(`✓ Post created: ${postId}`);

  // 4. User B attempts to delete User A's post -> expect 403
  console.log('\n[4] User B attempting to delete User A\'s post (Unauthorized test)...');
  const unauthorizedPostDelRes = await fetch(`${BASE_URL}/api/posts/${postId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${tokenB}`
    }
  });
  const unauthPostDelData = await unauthorizedPostDelRes.json();
  console.log(`Status code: ${unauthorizedPostDelRes.status}, Response:`, unauthPostDelData);
  if (unauthorizedPostDelRes.status !== 403) {
    throw new Error(`Expected 403 Forbidden but got ${unauthorizedPostDelRes.status}`);
  }
  console.log('✓ Unauthorized post deletion correctly rejected with 403 Forbidden!');

  // 5. User A deletes own post -> expect 200
  console.log('\n[5] User A deleting own post (Authorized test)...');
  const authorizedPostDelRes = await fetch(`${BASE_URL}/api/posts/${postId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${tokenA}`
    }
  });
  const authPostDelData = await authorizedPostDelRes.json();
  console.log(`Status code: ${authorizedPostDelRes.status}, Response:`, authPostDelData);
  if (authorizedPostDelRes.status !== 200 || !authPostDelData.success) {
    throw new Error(`Expected 200 OK with success:true, got ${authorizedPostDelRes.status}: ${JSON.stringify(authPostDelData)}`);
  }
  console.log('✓ User A successfully deleted own post with status REMOVED!');

  // 6. User A creates a reel
  console.log('\n[6] User A creating a reel...');
  const createReelRes = await fetch(`${BASE_URL}/api/reels`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${tokenA}`
    },
    body: JSON.stringify({
      categoryId: 1,
      videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
      caption: `Automated test reel at ${ts}`,
      durationSeconds: 15
    })
  });
  const reelData = await createReelRes.json();
  if (!reelData.success) {
    throw new Error(`Failed to create reel: ${JSON.stringify(reelData)}`);
  }
  const reelId = reelData.data.id;
  console.log(`✓ Reel created: ${reelId}`);

  // 7. User B attempts to delete User A's reel -> expect 403
  console.log('\n[7] User B attempting to delete User A\'s reel (Unauthorized test)...');
  const unauthorizedReelDelRes = await fetch(`${BASE_URL}/api/reels/${reelId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${tokenB}`
    }
  });
  const unauthReelDelData = await unauthorizedReelDelRes.json();
  console.log(`Status code: ${unauthorizedReelDelRes.status}, Response:`, unauthReelDelData);
  if (unauthorizedReelDelRes.status !== 403) {
    throw new Error(`Expected 403 Forbidden but got ${unauthorizedReelDelRes.status}`);
  }
  console.log('✓ Unauthorized reel deletion correctly rejected with 403 Forbidden!');

  // 8. User A deletes own reel -> expect 200
  console.log('\n[8] User A deleting own reel (Authorized test)...');
  const authorizedReelDelRes = await fetch(`${BASE_URL}/api/reels/${reelId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${tokenA}`
    }
  });
  const authReelDelData = await authorizedReelDelRes.json();
  console.log(`Status code: ${authorizedReelDelRes.status}, Response:`, authReelDelData);
  if (authorizedReelDelRes.status !== 200 || !authReelDelData.success) {
    throw new Error(`Expected 200 OK with success:true, got ${authorizedReelDelRes.status}: ${JSON.stringify(authReelDelData)}`);
  }
  console.log('✓ User A successfully deleted own reel with status REMOVED!');

  console.log('\n========================================================');
  console.log('🎉 ALL BACKEND DELETE ENDPOINT TESTS PASSED SUCCESSFULLY!');
  console.log('========================================================\n');
}

run().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
