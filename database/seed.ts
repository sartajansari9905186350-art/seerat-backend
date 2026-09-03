import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { query, withTransaction } from '../src/config/database';
import { logger } from '../src/utils/logger';

export const seedDatabase = async (): Promise<void> => {
  logger.info('[DEVELOPMENT SEED] Starting SEERAT seed data insertion...');

  try {
    await withTransaction(async (client) => {
      // 1. Seed Super Admin & Moderator
      const salt = await bcrypt.genSalt(12);
      const superAdminPass = await bcrypt.hash(process.env.ADMIN_INITIAL_PASSWORD || 'Seerat@99051', salt);
      const moderatorPass = await bcrypt.hash('Mod@Seerat2026!', salt);

      const superAdminId = uuidv4();
      const moderatorId = uuidv4();

      await client.query(
        `INSERT INTO admin_users (id, name, email, password_hash, role, status, avatar_url)
         VALUES 
          ($1, 'Sartaj Ansari', 'helpwaladost@gmail.com', $2, 'SUPER_ADMIN', 'ACTIVE', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150'),
          ($3, 'Zayd Al-Ansari', 'moderator@seerat.app', $4, 'MODERATOR', 'ACTIVE', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150')
         ON CONFLICT (email) DO UPDATE 
         SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, status = EXCLUDED.status`,
        [superAdminId, superAdminPass, moderatorId, moderatorPass]
      );
      logger.info('Admin users seeded.');

      // 2. Seed Users & Profiles
      const userPass = await bcrypt.hash('SeeratUser123!', 10);
      const users = [
        { id: uuidv4(), name: 'Qari Ahmadullah', username: 'qari_ahmad', email: 'qari.ahmad@example.com', verified: true, status: 'ACTIVE', followers: 24500, following: 42, posts: 18, reels: 14, bio: 'Quran Teacher & Certified Qari (Hafs recitation).' },
        { id: uuidv4(), name: 'Sheikh Bilal Philips', username: 'sheikh_bilal', email: 'bilal.p@example.com', verified: true, status: 'ACTIVE', followers: 58900, following: 12, posts: 45, reels: 32, bio: 'Islamic Scholar & Educator. Sharing authentic Hadith.' },
        { id: uuidv4(), name: 'Fatima Al-Zahra', username: 'fatima_zahra', email: 'fatima.z@example.com', verified: false, status: 'ACTIVE', followers: 3200, following: 120, posts: 9, reels: 6, bio: 'Dua reflections & daily Islamic lifestyle.' },
        { id: uuidv4(), name: 'Tariq Jameel Media', username: 'tariq_media', email: 'media@tariq.example.com', verified: true, status: 'ACTIVE', followers: 89000, following: 5, posts: 80, reels: 55, bio: 'Short clips and soulful Bayans from famous Islamic lectures.' },
        { id: uuidv4(), name: 'Spam Account 404', username: 'crypto_spammer', email: 'spam.bot@example.com', verified: false, status: 'SUSPENDED', followers: 10, following: 800, posts: 1, reels: 0, bio: 'Suspended for advertising crypto links.' }
      ];

      for (const u of users) {
        await client.query(
          `INSERT INTO users (id, name, username, email, password_hash, is_verified, status, suspension_reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (email) DO NOTHING`,
          [u.id, u.name, u.username, u.email, userPass, u.verified, u.status, u.status === 'SUSPENDED' ? 'Violated Islamic Content Guidelines (Spam/Commercial Links)' : null]
        );

        await client.query(
          `INSERT INTO profiles (user_id, bio, followers_count, following_count, posts_count, reels_count)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (user_id) DO UPDATE SET followers_count = EXCLUDED.followers_count, following_count = EXCLUDED.following_count`,
          [u.id, u.bio, u.followers, u.following, u.posts, u.reels]
        );
      }

      // 3. Seed Media Assets
      const mediaItems = [
        { id: uuidv4(), owner_id: users[0].id, type: 'VIDEO', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4', thumb: 'https://images.unsplash.com/photo-1609599006353-e629aaabfeae?w=600', duration: 45 },
        { id: uuidv4(), owner_id: users[1].id, type: 'VIDEO', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4', thumb: 'https://images.unsplash.com/photo-1542816417-0983c9c9ad53?w=600', duration: 60 },
        { id: uuidv4(), owner_id: users[3].id, type: 'VIDEO', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', thumb: 'https://images.unsplash.com/photo-1564769625905-50e93615e769?w=600', duration: 30 },
        { id: uuidv4(), owner_id: users[2].id, type: 'PHOTO', url: 'https://images.unsplash.com/photo-1590076215667-873d3a772590?w=800', thumb: 'https://images.unsplash.com/photo-1590076215667-873d3a772590?w=600', duration: 0 }
      ];

      for (const m of mediaItems) {
        await client.query(
          `INSERT INTO media (id, owner_id, media_type, url, thumbnail_url, duration, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'READY')
           ON CONFLICT (id) DO NOTHING`,
          [m.id, m.owner_id, m.type, m.url, m.thumb, m.duration]
        );
      }

      // 4. Seed Posts
      const post1Id = uuidv4();
      const post2Id = uuidv4();
      const post3Id = uuidv4();

      await client.query(
        `INSERT INTO posts (id, user_id, category_id, content_type, text_content, arabic_text, translation_text, reference_source, status, likes_count, comments_count)
         VALUES 
          ($1, $2, 1, 'TEXT', 'Recitation and reflection on Surah Al-Kahf verses 1-10.', 'الْحَمْدُ لِلَّهِ الَّذِي أَنزَلَ عَلَىٰ عَبْدِهِ الْكِتَابَ وَلَمْ يَجْعَل لَّهُ عِوَجًا', '[All] praise is [due] to Allah, who has sent down upon His Servant the Book and has not made therein any deviance.', 'Surah Al-Kahf 18:1', 'APPROVED', 1240, 85),
          ($3, $4, 2, 'TEXT', 'The best amongst you are those who learn the Quran and teach it.', 'خَيْرُكُمْ مَنْ تَعَلَّمَ الْقُرْآنَ وَعَلَّمَهُ', 'The most superior among you are those who learn the Quran and teach it to others.', 'Sahih Bukhari 5027', 'PENDING_REVIEW', 0, 0),
          ($5, $6, 3, 'PHOTO', 'Morning Dua for Barakah and Protection from Anxiety and Debt.', 'اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنَ الْهَمِّ وَالْحَزَنِ، وَالْعَجْزِ وَالْكَسَلِ', 'O Allah, I seek refuge in You from anxiety and sorrow, weakness and laziness...', 'Sahih Bukhari 6363', 'PENDING_REVIEW', 0, 0)
         ON CONFLICT (id) DO NOTHING`,
        [post1Id, users[0].id, post2Id, users[1].id, post3Id, users[2].id]
      );

      // 5. Seed Reels
      const reel1Id = uuidv4();
      const reel2Id = uuidv4();

      await client.query(
        `INSERT INTO reels (id, user_id, category_id, media_id, caption, audio_title, audio_artist, reference_source, status, likes_count, comments_count, views_count)
         VALUES 
          ($1, $2, 1, $3, 'Heart-soothing Tilawat of Surah Ar-Rahman by Qari Ahmadullah in Maqam Bayati.', 'Surah Ar-Rahman - Bayati', 'Qari Ahmadullah', 'Surah Ar-Rahman 55:1-13', 'APPROVED', 5400, 320, 24500),
          ($4, $5, 4, $6, 'Why Tahajjud changes your entire life. Never miss the last third of the night.', 'The Power of Night Prayer', 'Sheikh Bilal', 'Sahih Muslim 758', 'PENDING_REVIEW', 0, 0, 0)
         ON CONFLICT (id) DO NOTHING`,
        [reel1Id, users[0].id, mediaItems[0].id, reel2Id, users[1].id, mediaItems[1].id]
      );

      // 6. Moderation Reviews
      await client.query(
        `INSERT INTO moderation_reviews (content_type, content_id, user_id, status)
         VALUES 
          ('POST', $1, $2, 'PENDING_REVIEW'),
          ('POST', $3, $4, 'PENDING_REVIEW'),
          ('REEL', $5, $6, 'PENDING_REVIEW')
         ON CONFLICT DO NOTHING`,
        [post2Id, users[1].id, post3Id, users[2].id, reel2Id, users[1].id]
      );

      // 7. Seed Reports
      await client.query(
        `INSERT INTO reports (reporter_id, target_type, target_id, reason, details, status)
         VALUES 
          ($1, 'POST', $2, 'WRONG_INFO', 'The reference citation seems to have a typo in the hadith number.', 'OPEN'),
          ($3, 'USER', $4, 'SPAM', 'User keeps posting commercial crypto spam comments.', 'RESOLVED')
         ON CONFLICT DO NOTHING`,
        [users[2].id, post2Id, users[0].id, users[4].id]
      );

      // 8. Seed Audit Logs
      await client.query(
        `INSERT INTO admin_audit_logs (admin_id, admin_name, admin_email, action, target_type, target_id, reason)
         VALUES 
          ($1, 'Sartaj Ansari', 'helpwaladost@gmail.com', 'APPROVED_CONTENT', 'REEL', $2, 'Verified authentic Tilawat recitation by certified Qari.'),
          ($1, 'Sartaj Ansari', 'helpwaladost@gmail.com', 'CREATED_ADMIN', 'ADMIN', $3, 'Appointed Zayd Al-Ansari as Content Moderator.')
         ON CONFLICT DO NOTHING`,
        [superAdminId, reel1Id, moderatorId]
      );

      // 9. Admin Notifications
      await client.query(
        `INSERT INTO admin_notifications (type, title, message, target_type, target_id, is_read)
         VALUES 
          ('PENDING_REVIEW', 'New Reel Awaiting Review', 'Sheikh Bilal submitted a new video reel under category Bayan.', 'REEL', $1, FALSE),
          ('REPORT_FILED', 'New Report on Content', 'A user reported a potential reference discrepancy in Post.', 'REPORT', NULL, FALSE)
         ON CONFLICT DO NOTHING`,
        [reel2Id]
      );
    });

    logger.info('Development seeding successfully completed!');
  } catch (err) {
    logger.error('CRITICAL: Database seeding failed!', err);
    throw err;
  }
};

if (require.main === module) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
