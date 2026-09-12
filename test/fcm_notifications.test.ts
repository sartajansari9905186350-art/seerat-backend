import request from 'supertest';
import { pool, testConnection } from '../src/config/database';
import { ensurePostgresRunning } from '../database/startDb';
import { runMigration } from '../database/migrate';
import { seedDatabase } from '../database/seed';
import app from '../src/app';
import { fcmService } from '../src/services/fcm.service';

async function runFcmNotificationsTest() {
  console.log('\n================================================================');
  console.log('🔔 SEERAT FCM PUSH NOTIFICATIONS — INTEGRATION TEST SUITE');
  console.log('================================================================\n');

  await ensurePostgresRunning();
  await testConnection();
  await runMigration();
  await seedDatabase();

  // Ensure tables and columns exist
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_fcm_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL,
      device_type VARCHAR(50) DEFAULT 'ANDROID',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uq_user_device_token UNIQUE (user_id, token)
    );
    CREATE INDEX IF NOT EXISTS idx_user_fcm_tokens_user_id ON user_fcm_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_fcm_tokens_token ON user_fcm_tokens(token);
  `);

  // Create User 1
  console.log('👤 [1/7] Creating test users...');
  const user1Email = `fcm_user1_${Date.now()}@seerat.app`;
  const user2Email = `fcm_user2_${Date.now()}@seerat.app`;

  const signup1 = await request(app).post('/api/auth/signup').send({
    name: 'Tariq FCM',
    username: `tariq_${Date.now()}`,
    email: user1Email,
    password: 'Password123!',
    phone: `+91${Math.floor(1000000000 + Math.random() * 9000000000)}`
  });
  const token1 = signup1.body.data.token;
  const user1Id = signup1.body.data.user.id;

  const signup2 = await request(app).post('/api/auth/signup').send({
    name: 'Zaid FCM',
    username: `zaid_${Date.now()}`,
    email: user2Email,
    password: 'Password123!',
    phone: `+91${Math.floor(1000000000 + Math.random() * 9000000000)}`
  });
  const token2 = signup2.body.data.token;
  const user2Id = signup2.body.data.user.id;

  console.log(`  ✓ Created user 1 (${user1Id}) and user 2 (${user2Id})`);

  // 2. Register Device Token
  console.log('📲 [2/7] Registering FCM token for User 1...');
  const fcmToken1 = 'test_fcm_token_device_phone_12345';
  const regRes = await request(app)
    .post('/api/notifications/token')
    .set('Authorization', `Bearer ${token1}`)
    .send({ token: fcmToken1, deviceType: 'ANDROID' });

  if (regRes.status !== 200 || !regRes.body.success) {
    throw new Error(`Token registration failed: ${JSON.stringify(regRes.body)}`);
  }
  console.log('  ✓ FCM token registered successfully');

  // Verify in DB
  const dbCheck1 = await pool.query('SELECT * FROM user_fcm_tokens WHERE user_id = $1', [user1Id]);
  if (dbCheck1.rows.length !== 1 || dbCheck1.rows[0].token !== fcmToken1) {
    throw new Error('Database verification failed for user 1 token.');
  }
  console.log(`  ✓ Database verified 1 device token for User 1`);

  // 3. Register a second device for User 1 (Multiple devices support)
  console.log('📱 [3/7] Testing multi-device support for User 1...');
  const fcmTokenTablet = 'test_fcm_token_device_tablet_67890';
  await request(app)
    .post('/api/notifications/token')
    .set('Authorization', `Bearer ${token1}`)
    .send({ token: fcmTokenTablet, deviceType: 'ANDROID' });

  const dbCheckMulti = await pool.query('SELECT * FROM user_fcm_tokens WHERE user_id = $1', [user1Id]);
  if (dbCheckMulti.rows.length !== 2) {
    throw new Error(`Expected 2 tokens for user 1, got ${dbCheckMulti.rows.length}`);
  }
  console.log(`  ✓ Multiple devices supported. User 1 now has ${dbCheckMulti.rows.length} registered devices.`);

  // 4. Token Reassignment / Device handoff (User 2 logs into phone with same token)
  console.log('🔄 [4/7] Testing token re-assignment when User 2 logs into the same phone...');
  await request(app)
    .post('/api/notifications/token')
    .set('Authorization', `Bearer ${token2}`)
    .send({ token: fcmToken1, deviceType: 'ANDROID' });

  const checkUser1AfterHandoff = await pool.query('SELECT * FROM user_fcm_tokens WHERE user_id = $1 AND token = $2', [user1Id, fcmToken1]);
  const checkUser2AfterHandoff = await pool.query('SELECT * FROM user_fcm_tokens WHERE user_id = $1 AND token = $2', [user2Id, fcmToken1]);
  if (checkUser1AfterHandoff.rows.length !== 0 || checkUser2AfterHandoff.rows.length !== 1) {
    throw new Error('Device handoff failed: token was not reassigned cleanly.');
  }
  console.log('  ✓ Token cleanly reassigned to User 2 without duplicate or security leak.');

  // 5. Remove Token on Logout
  console.log('🚪 [5/7] Testing token removal on logout...');
  const delRes = await request(app)
    .delete('/api/notifications/token')
    .set('Authorization', `Bearer ${token2}`)
    .send({ token: fcmToken1 });

  if (delRes.status !== 200) {
    throw new Error(`Token removal failed: ${JSON.stringify(delRes.body)}`);
  }
  const checkUser2AfterLogout = await pool.query('SELECT * FROM user_fcm_tokens WHERE user_id = $1', [user2Id]);
  if (checkUser2AfterLogout.rows.length !== 0) {
    throw new Error('Token was not removed from DB on logout.');
  }
  console.log('  ✓ Token removed successfully on logout.');

  // 6. Direct FCM Service dispatch test
  console.log('🚀 [6/7] Testing fcmService.sendToUser dispatch...');
  // Re-register token for user 1
  await fcmService.registerToken(user1Id, 'fcm_test_token_live', 'ANDROID');
  await fcmService.sendToUser(user1Id, {
    title: 'SEERAT',
    body: 'Test notification payload',
    data: { type: 'LIKE', postId: 'test-post-id', targetScreen: 'POST_DETAIL' }
  });
  console.log('  ✓ fcmService.sendToUser executed safely without throwing.');

  // 7. Test Follow Notification with Push trigger
  console.log('🤝 [7/7] Testing social follow event with real notification...');
  const followRes = await request(app)
    .post(`/api/users/${user1Id}/follow`)
    .set('Authorization', `Bearer ${token2}`);

  if (followRes.status !== 200) {
    throw new Error(`Follow failed: ${JSON.stringify(followRes.body)}`);
  }

  const notificationsRes = await request(app)
    .get('/api/notifications')
    .set('Authorization', `Bearer ${token1}`);

  if (notificationsRes.status !== 200 || notificationsRes.body.data.length === 0) {
    throw new Error('Inbox notification was not created in database.');
  }
  console.log(`  ✓ Follow triggered notification created in database for User 1: "${notificationsRes.body.data[0].message}"`);

  console.log('\n================================================================');
  console.log('🎉 ALL FCM BACKEND INTEGRATION TESTS PASSED!');
  console.log('================================================================\n');

  await pool.end();
  process.exit(0);
}

runFcmNotificationsTest().catch((err) => {
  console.error('❌ FCM Integration Test Failed:', err);
  process.exit(1);
});
