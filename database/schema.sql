-- ====================================================================
-- SEERAT Islamic Social & Reels Platform - Production Database Schema
-- ====================================================================

-- Drop Tables if they exist (Clean Migration Reset)
DROP TABLE IF EXISTS not_interested_reels CASCADE;
DROP TABLE IF EXISTS user_warnings CASCADE;
DROP TABLE IF EXISTS admin_audit_logs CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS moderation_reviews CASCADE;
DROP TABLE IF EXISTS moderation_actions CASCADE;
DROP TABLE IF EXISTS moderation_queue CASCADE;
DROP TABLE IF EXISTS reports CASCADE;
DROP TABLE IF EXISTS admin_notifications CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS system_settings CASCADE;
DROP TABLE IF EXISTS post_hashtags CASCADE;
DROP TABLE IF EXISTS hashtags CASCADE;
DROP TABLE IF EXISTS blocked_users CASCADE;
DROP TABLE IF EXISTS muted_users CASCADE;
DROP TABLE IF EXISTS follows CASCADE;
DROP TABLE IF EXISTS saves CASCADE;
DROP TABLE IF EXISTS likes CASCADE;
DROP TABLE IF EXISTS comment_likes CASCADE;
DROP TABLE IF EXISTS comments CASCADE;
DROP TABLE IF EXISTS reels CASCADE;
DROP TABLE IF EXISTS posts CASCADE;
DROP TABLE IF EXISTS media CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;
DROP TABLE IF EXISTS admin_users CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Enable UUID extension if available
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Users Table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(50),
    password_hash VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'ACTIVE', -- 'ACTIVE', 'SUSPENDED', 'DISABLED'
    is_verified BOOLEAN DEFAULT FALSE,
    is_private BOOLEAN DEFAULT FALSE,
    profile_photo_url VARCHAR(1024) DEFAULT '',
    suspension_reason TEXT,
    suspended_at TIMESTAMP WITH TIME ZONE,
    suspended_until TIMESTAMP WITH TIME ZONE,
    suspended_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_created_at ON users(created_at DESC);

-- 2. Profiles Table
CREATE TABLE profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    bio TEXT DEFAULT '',
    profile_photo VARCHAR(1024) DEFAULT '',
    followers_count INT DEFAULT 0,
    following_count INT DEFAULT 0,
    posts_count INT DEFAULT 0,
    reels_count INT DEFAULT 0,
    likes_count INT DEFAULT 0,
    website VARCHAR(255) DEFAULT '',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Admin Users Table (Role-Based Access: SUPER_ADMIN, MODERATOR)
CREATE TABLE admin_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'MODERATOR', -- 'SUPER_ADMIN', 'MODERATOR'
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'DISABLED'
    avatar_url VARCHAR(1024) DEFAULT '',
    admin_profile_photo_url VARCHAR(1024) DEFAULT '',
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_admin_users_email ON admin_users(email);
CREATE INDEX idx_admin_users_role ON admin_users(role);

-- 4. Categories Table (Islamic-only Content Categorization)
CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL, -- 'quran', 'hadith', 'dua', 'bayan', 'zikr', 'seerah', 'reminder'
    arabic_name VARCHAR(100),
    description TEXT DEFAULT '',
    icon VARCHAR(100) DEFAULT '',
    sort_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Media Table (Storage Metadata Abstraction for Local/S3/CDN)
CREATE TABLE media (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_type VARCHAR(50) NOT NULL, -- 'PHOTO', 'VIDEO', 'AUDIO'
    url VARCHAR(1024) NOT NULL,
    thumbnail_url VARCHAR(1024),
    duration INT DEFAULT 0, -- seconds for video/audio
    width INT DEFAULT 0,
    height INT DEFAULT 0,
    file_size BIGINT DEFAULT 0,
    mime_type VARCHAR(100) DEFAULT 'video/mp4',
    storage_provider VARCHAR(50) DEFAULT 'LOCAL', -- 'LOCAL', 'S3', 'CDN'
    status VARCHAR(50) DEFAULT 'READY',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_media_owner ON media(owner_id);

-- 6. Posts Table (Islamic Feed Content)
CREATE TABLE posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id INT REFERENCES categories(id) ON DELETE SET NULL,
    content_type VARCHAR(50) NOT NULL DEFAULT 'TEXT', -- 'PHOTO', 'VIDEO', 'TEXT'
    text_content TEXT DEFAULT '',
    arabic_text TEXT DEFAULT '',
    translation_text TEXT DEFAULT '',
    reference_source VARCHAR(255) DEFAULT '',
    media_id UUID REFERENCES media(id) ON DELETE SET NULL,
    language VARCHAR(20) DEFAULT 'en', -- 'en', 'ur', 'ar', 'hi'
    status VARCHAR(50) DEFAULT 'PENDING_REVIEW', -- 'DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'REMOVED', 'SUSPENDED'
    rejection_reason TEXT,
    likes_count INT DEFAULT 0,
    comments_count INT DEFAULT 0,
    shares_count INT DEFAULT 0,
    saves_count INT DEFAULT 0,
    views_count INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_posts_user_id ON posts(user_id);
CREATE INDEX idx_posts_category_id ON posts(category_id);
CREATE INDEX idx_posts_status ON posts(status);
CREATE INDEX idx_posts_created_at ON posts(created_at DESC);

-- 7. Reels Table (Vertical Islamic Video Reels)
CREATE TABLE reels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id INT REFERENCES categories(id) ON DELETE SET NULL,
    media_id UUID NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    caption TEXT DEFAULT '',
    audio_title VARCHAR(255) DEFAULT 'Original Islamic Audio',
    audio_artist VARCHAR(255) DEFAULT 'SEERAT Creator',
    reference_source VARCHAR(255) DEFAULT '',
    language VARCHAR(20) DEFAULT 'en',
    status VARCHAR(50) DEFAULT 'PENDING_REVIEW', -- 'DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'REMOVED', 'SUSPENDED'
    rejection_reason TEXT,
    likes_count INT DEFAULT 0,
    comments_count INT DEFAULT 0,
    shares_count INT DEFAULT 0,
    saves_count INT DEFAULT 0,
    views_count INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_reels_user_id ON reels(user_id);
CREATE INDEX idx_reels_category_id ON reels(category_id);
CREATE INDEX idx_reels_status ON reels(status);
CREATE INDEX idx_reels_created_at ON reels(created_at DESC);

-- 8. Comments Table
CREATE TABLE comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
    reel_id UUID REFERENCES reels(id) ON DELETE CASCADE,
    parent_comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    likes_count INT DEFAULT 0,
    is_flagged BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_comments_post_id ON comments(post_id);
CREATE INDEX idx_comments_reel_id ON comments(reel_id);

-- 9. Comment Likes Table
CREATE TABLE comment_likes (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    comment_id UUID NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, comment_id)
);

-- 10. Likes Table
CREATE TABLE likes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
    reel_id UUID REFERENCES reels(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_user_post_like UNIQUE (user_id, post_id),
    CONSTRAINT uq_user_reel_like UNIQUE (user_id, reel_id)
);

CREATE INDEX idx_likes_user ON likes(user_id);
CREATE INDEX idx_likes_post ON likes(post_id);
CREATE INDEX idx_likes_reel ON likes(reel_id);

-- 11. Saves / Bookmarks
CREATE TABLE saves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
    reel_id UUID REFERENCES reels(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_saves_user ON saves(user_id);

-- 11b. Not Interested Content Table (User-Specific Feed Customization)
CREATE TABLE not_interested_reels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reel_id UUID NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_not_interested UNIQUE (user_id, reel_id)
);

CREATE INDEX idx_not_interested_user ON not_interested_reels(user_id);
CREATE INDEX idx_not_interested_reel ON not_interested_reels(reel_id);

-- 12. Follows Table
CREATE TABLE follows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'ACCEPTED',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_follower_following UNIQUE (follower_id, following_id)
);

-- 13. Reports Table (User Flagging & Content Reports)
CREATE TABLE reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type VARCHAR(50) NOT NULL, -- 'POST', 'REEL', 'USER', 'COMMENT'
    target_id UUID NOT NULL,
    reason VARCHAR(100) NOT NULL, -- 'WRONG_INFO', 'INAPPROPRIATE', 'SPAM', 'HARASSMENT', 'COPYRIGHT', 'FAKE_ACCOUNT', 'OTHER'
    details TEXT DEFAULT '',
    status VARCHAR(50) DEFAULT 'OPEN', -- 'OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED'
    action_taken VARCHAR(100) DEFAULT '',
    resolved_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    resolution_notes TEXT DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_reports_status ON reports(status);
CREATE INDEX idx_reports_target ON reports(target_type, target_id);
CREATE INDEX idx_reports_created_at ON reports(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_reporter_target ON reports(reporter_id, target_type, target_id) WHERE status IN ('PENDING', 'OPEN');

-- 14. Moderation Reviews Queue Table
CREATE TABLE moderation_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_type VARCHAR(50) NOT NULL, -- 'POST', 'REEL'
    content_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'PENDING_REVIEW', -- 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'FLAGGED', 'REMOVED'
    rejection_reason VARCHAR(255),
    notes TEXT,
    reviewed_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_moderation_reviews_status ON moderation_reviews(status);
CREATE INDEX idx_moderation_reviews_content ON moderation_reviews(content_type, content_id);

-- 15. Admin Audit Logs Table (Immutable Audit Trail)
CREATE TABLE admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    admin_name VARCHAR(255) NOT NULL,
    admin_email VARCHAR(255) NOT NULL,
    action VARCHAR(100) NOT NULL, -- 'APPROVED_CONTENT', 'REJECTED_CONTENT', 'REMOVED_CONTENT', 'RESTORED_CONTENT', 'SUSPENDED_USER', 'UNSUSPENDED_USER', 'DISABLED_USER', 'RESTORED_USER', 'RESOLVED_REPORT', 'DISMISSED_REPORT', 'CREATED_ADMIN', 'UPDATED_ADMIN', 'DELETED_ADMIN', 'CHANGED_SETTINGS'
    target_type VARCHAR(50) NOT NULL, -- 'POST', 'REEL', 'USER', 'REPORT', 'ADMIN', 'SETTINGS'
    target_id VARCHAR(255),
    reason TEXT,
    details JSONB DEFAULT '{}'::jsonb,
    ip_address VARCHAR(100) DEFAULT '127.0.0.1',
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_admin_audit_logs_action ON admin_audit_logs(action);
CREATE INDEX idx_admin_audit_logs_admin ON admin_audit_logs(admin_id);
CREATE INDEX idx_admin_audit_logs_created_at ON admin_audit_logs(created_at DESC);

-- 15b. User Warnings Table (Persistent Moderation Warnings)
CREATE TABLE user_warnings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    admin_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    reason VARCHAR(255) NOT NULL,
    notes TEXT DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_warnings_user ON user_warnings(user_id);
CREATE INDEX idx_user_warnings_created_at ON user_warnings(created_at DESC);

-- 16. Admin Notifications Table
CREATE TABLE admin_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(50) NOT NULL, -- 'PENDING_REVIEW', 'REPORT_FILED', 'USER_FLAGGED', 'SYSTEM_ALERT'
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    target_type VARCHAR(50),
    target_id VARCHAR(255),
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_admin_notifications_is_read ON admin_notifications(is_read);
CREATE INDEX idx_admin_notifications_created_at ON admin_notifications(created_at DESC);

-- 17. User Notifications Table
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    type VARCHAR(50) NOT NULL, -- 'LIKE', 'COMMENT', 'FOLLOW', 'CONTENT_APPROVED', 'CONTENT_REJECTED', 'SYSTEM_ANNOUNCEMENT'
    post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
    reel_id UUID REFERENCES reels(id) ON DELETE CASCADE,
    comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 18. System Settings Table
CREATE TABLE system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    category VARCHAR(50) DEFAULT 'GENERAL', -- 'GENERAL', 'MODERATION', 'SECURITY'
    updated_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert Default Islamic Categories
INSERT INTO categories (id, name, slug, arabic_name, description, sort_order) VALUES
(1, 'Quran', 'quran', 'القرآن الكريم', 'Recitations, Tafseer, and Quranic Verses', 1),
(2, 'Hadith', 'hadith', 'الحديث النبوي', 'Authentic Prophetic Traditions and Sayings', 2),
(3, 'Dua', 'dua', 'الأدعية والأذكار', 'Supplications and Invocations', 3),
(4, 'Bayan', 'bayan', 'البيان والمواعظ', 'Islamic Lectures, Khutbahs, and Short Bayans', 4),
(5, 'Zikr', 'zikr', 'الذكر والتسبيح', 'Remembrances, Tasbih, and Durood', 5),
(6, 'Seerah', 'seerah', 'السيرة النبوية', 'Biography of Prophet Muhammad (PBUH) & Companions', 6),
(7, 'Islamic Reminder', 'reminder', 'مواعظ إسلامية', 'Daily inspirational reflections and moral reminders', 7)
ON CONFLICT (slug) DO NOTHING;

-- Insert Default System Settings
INSERT INTO system_settings (key, value, description, category) VALUES
('general_settings', '{"appName": "SEERAT", "maintenanceMode": false, "newUserRegistration": true, "contentModerationEnabled": true}'::jsonb, 'Global application configuration', 'GENERAL'),
('moderation_settings', '{"autoFlagKeywords": true, "requireApprovalBeforePublic": true, "maxReportsBeforeAutoHold": 3, "allowedLanguages": ["en", "ur", "ar", "hi"]}'::jsonb, 'Islamic content moderation settings', 'MODERATION'),
('security_settings', '{"adminSessionTimeoutMinutes": 120, "maxLoginAttempts": 5, "lockoutDurationMinutes": 15, "requireStrongPassword": true}'::jsonb, 'Administrative security and authentication policies', 'SECURITY')
ON CONFLICT (key) DO NOTHING;

-- 19. Phone OTPs Table
CREATE TABLE IF NOT EXISTS phone_otps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone VARCHAR(50) NOT NULL,
    otp VARCHAR(10) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    attempts INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_phone_otps_phone ON phone_otps(phone);

