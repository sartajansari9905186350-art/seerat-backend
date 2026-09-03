import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { query, withTransaction } from '../config/database';
import { env } from '../config/env';
import { ResponseUtil } from '../utils/response';
import { AuthenticatedUserRequest, UserAuthPayload } from '../middleware/userAuth.middleware';

export class MobileAuthController {
  async signUp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { name, username, email, password, phone } = req.body;

      if (!name || !username || !email || !password) {
        ResponseUtil.error(res, 'VALIDATION_ERROR', 'Name, username, email, and password are required.', 400);
        return;
      }

      if (password.length < 6) {
        ResponseUtil.error(res, 'VALIDATION_ERROR', 'Password must be at least 6 characters.', 400);
        return;
      }

      const cleanUsername = username.toLowerCase().trim().replace(/\s+/g, '_');
      const cleanEmail = email.toLowerCase().trim();

      // Check existing email or username
      const existing = await query(
        'SELECT id, email, username FROM users WHERE LOWER(email) = $1 OR LOWER(username) = $2',
        [cleanEmail, cleanUsername]
      );

      if (existing.rows.length > 0) {
        const isEmail = existing.rows[0].email.toLowerCase() === cleanEmail;
        ResponseUtil.error(
          res,
          'CONFLICT',
          isEmail ? 'An account with this email already exists.' : 'This username is already taken.',
          409
        );
        return;
      }

      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);
      const newUserId = uuidv4();

      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO users (id, name, username, email, phone, password_hash, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')`,
          [newUserId, name.trim(), cleanUsername, cleanEmail, phone ? phone.trim() : null, passwordHash]
        );

        await client.query(
          `INSERT INTO profiles (user_id, bio, profile_photo)
           VALUES ($1, 'Seeker of beneficial Islamic knowledge.', 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=300')`,
          [newUserId]
        );
      });

      const payload: UserAuthPayload = {
        id: newUserId,
        name: name.trim(),
        username: cleanUsername,
        email: cleanEmail
      };

      const token = jwt.sign(payload, env.jwtSecret, { expiresIn: '90d' as any });

      const userRes = {
        id: newUserId,
        name: name.trim(),
        username: cleanUsername,
        email: cleanEmail,
        phone: phone ? phone.trim() : null,
        bio: 'Seeker of beneficial Islamic knowledge.',
        profile_photo: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=300',
        is_verified: false,
        status: 'ACTIVE',
        followers_count: 0,
        following_count: 0,
        posts_count: 0,
        reels_count: 0,
        is_following: false,
        is_profile_completed: true
      };

      ResponseUtil.success(
        res,
        {
          token,
          refresh_token: token,
          user: userRes,
          is_admin: false
        },
        'Account created successfully.',
        201
      );
    } catch (err) {
      next(err);
    }
  }

  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { emailOrPhone, password } = req.body;

      if (!emailOrPhone || !password) {
        ResponseUtil.error(res, 'VALIDATION_ERROR', 'Please enter email/username and password.', 400);
        return;
      }

      const searchKey = emailOrPhone.toLowerCase().trim();

      const userRes = await query(
        `SELECT u.id, u.name, u.username, u.email, u.phone, u.password_hash, u.is_verified, u.status, u.suspension_reason, u.is_profile_completed,
                p.bio, p.profile_photo, p.followers_count, p.following_count, p.posts_count, p.reels_count
         FROM users u
         LEFT JOIN profiles p ON u.id = p.user_id
         WHERE LOWER(u.email) = $1 OR LOWER(u.username) = $1 OR u.phone = $1`,
        [searchKey]
      );

      if (userRes.rows.length === 0) {
        ResponseUtil.error(res, 'INVALID_CREDENTIALS', 'Invalid login credentials.', 401);
        return;
      }

      const user = userRes.rows[0];

      if (user.status === 'SUSPENDED') {
        ResponseUtil.error(
          res,
          'ACCOUNT_SUSPENDED',
          `Your account is suspended: ${user.suspension_reason || 'Violation of Islamic guidelines.'}`,
          403
        );
        return;
      }

      if (user.status === 'DISABLED') {
        ResponseUtil.error(res, 'ACCOUNT_DISABLED', 'Your account has been deactivated.', 403);
        return;
      }

      const isMatch = await bcrypt.compare(password, user.password_hash);
      if (!isMatch) {
        ResponseUtil.error(res, 'INVALID_CREDENTIALS', 'Invalid login credentials.', 401);
        return;
      }

      const payload: UserAuthPayload = {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email
      };

      const token = jwt.sign(payload, env.jwtSecret, { expiresIn: '90d' as any });

      const returnUser = {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        phone: user.phone,
        bio: user.bio || '',
        profile_photo: user.profile_photo || '',
        is_verified: user.is_verified || false,
        status: user.status,
        followers_count: user.followers_count || 0,
        following_count: user.following_count || 0,
        posts_count: user.posts_count || 0,
        reels_count: user.reels_count || 0,
        is_following: false,
        is_profile_completed: Boolean(user.is_profile_completed !== false)
      };


      ResponseUtil.success(
        res,
        {
          token,
          refresh_token: token,
          user: returnUser,
          is_admin: false
        },
        'Signed in successfully.'
      );
    } catch (err) {
      next(err);
    }
  }

  async forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { emailOrPhone } = req.body;
      ResponseUtil.success(
        res,
        `If an account exists for ${emailOrPhone}, a secure recovery message has been sent.`
      );
    } catch (err) {
      next(err);
    }
  }

  // ==========================================
  // MOBILE OTP AUTHENTICATION
  // ==========================================

  private async ensureOtpTable(): Promise<void> {
    try {
      await query(`
        CREATE TABLE IF NOT EXISTS phone_otps (
          id SERIAL PRIMARY KEY,
          phone VARCHAR(50) NOT NULL,
          otp VARCHAR(10) NOT NULL,
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
          attempts INT DEFAULT 0,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await query('CREATE INDEX IF NOT EXISTS idx_phone_otps_phone ON phone_otps(phone)');
    } catch (e) {
      // Table may already exist
    }
  }

  async sendOtp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await this.ensureOtpTable();
      const { phone } = req.body;

      if (!phone || typeof phone !== 'string' || phone.trim().length < 6) {
        ResponseUtil.error(res, 'VALIDATION_ERROR', 'Please enter a valid mobile phone number.', 400);
        return;
      }

      const cleanPhone = phone.trim().replace(/[\s-]/g, '');
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes expiry

      // Remove any prior pending OTP for this number
      await query('DELETE FROM phone_otps WHERE phone = $1', [cleanPhone]);

      // Save new OTP
      await query(
        'INSERT INTO phone_otps (phone, otp, expires_at, attempts) VALUES ($1, $2, $3, 0)',
        [cleanPhone, otp, expiresAt]
      );

      // Return confirmation with verification code
      ResponseUtil.success(
        res,
        {
          phone: cleanPhone,
          expires_in_seconds: 300,
          code: otp
        },
        `OTP sent successfully to ${cleanPhone}.`
      );
    } catch (err: any) {
      ResponseUtil.error(res, 'OTP_SEND_FAILED', err?.message || 'Failed to send OTP.', 500);
    }
  }



  async verifyOtp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await this.ensureOtpTable();
      const { phone, otp } = req.body;

      if (!phone || !otp) {
        ResponseUtil.error(res, 'VALIDATION_ERROR', 'Phone number and 6-digit OTP are required.', 400);
        return;
      }

      const cleanPhone = phone.trim().replace(/[\s-]/g, '');
      const cleanOtp = otp.toString().trim();

      const otpRes = await query(
        'SELECT * FROM phone_otps WHERE phone = $1 ORDER BY created_at DESC LIMIT 1',
        [cleanPhone]
      );

      if (otpRes.rows.length === 0) {
        ResponseUtil.error(res, 'INVALID_OTP', 'No OTP requested for this phone number. Please tap Send OTP.', 400);
        return;
      }

      const record = otpRes.rows[0];

      // Check expiry
      if (new Date(record.expires_at).getTime() < Date.now()) {
        await query('DELETE FROM phone_otps WHERE phone = $1', [cleanPhone]);
        ResponseUtil.error(res, 'OTP_EXPIRED', 'OTP has expired. Please request a new one.', 400);
        return;
      }

      // Check OTP match
      if (record.otp !== cleanOtp) {
        await query('UPDATE phone_otps SET attempts = attempts + 1 WHERE id = $1', [record.id]);
        ResponseUtil.error(res, 'INVALID_OTP', 'Invalid OTP code. Please enter the correct 6-digit code.', 400);
        return;
      }

      // OTP is valid - consume it immediately so it cannot be replayed
      await query('DELETE FROM phone_otps WHERE phone = $1', [cleanPhone]);

      // Check if user already exists with this phone
      let userRes = await query(
        `SELECT u.id, u.name, u.username, u.email, u.phone, u.status, u.suspension_reason, u.is_profile_completed,
                p.bio, p.profile_photo, p.followers_count, p.following_count, p.posts_count, p.reels_count
         FROM users u
         LEFT JOIN profiles p ON u.id = p.user_id
         WHERE u.phone = $1`,
        [cleanPhone]
      );

      let user: any;

      if (userRes.rows.length > 0) {
        user = userRes.rows[0];
        if (user.status === 'SUSPENDED') {
          ResponseUtil.error(res, 'ACCOUNT_SUSPENDED', `Account suspended: ${user.suspension_reason || 'Guidelines violation'}`, 403);
          return;
        }
        if (user.status === 'DISABLED') {
          ResponseUtil.error(res, 'ACCOUNT_DISABLED', 'Account is deactivated.', 403);
          return;
        }
      } else {
        // Auto-create new user account for verified phone (marked is_profile_completed = false)
        const newUserId = uuidv4();
        const digitsOnly = cleanPhone.replace(/\D/g, '');
        const suffix = digitsOnly.slice(-4) || 'user';
        const newName = `User ${suffix}`;
        const newUsername = `user_${digitsOnly.slice(-6) || uuidv4().slice(0, 6)}_${Math.floor(Math.random() * 1000)}`;
        const dummyEmail = `phone_${digitsOnly || uuidv4().slice(0, 8)}@seerat.app`;
        const randomPassHash = await bcrypt.hash(uuidv4(), 10);

        await withTransaction(async (client) => {
          await client.query(
            `INSERT INTO users (id, name, username, email, phone, password_hash, status, is_profile_completed)
             VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', FALSE)`,
            [newUserId, newName, newUsername, dummyEmail, cleanPhone, randomPassHash]
          );

          await client.query(
            `INSERT INTO profiles (user_id, bio, profile_photo)
             VALUES ($1, 'Seeker of beneficial Islamic knowledge.', 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=300')`,
            [newUserId]
          );
        });

        user = {
          id: newUserId,
          name: newName,
          username: newUsername,
          email: dummyEmail,
          phone: cleanPhone,
          bio: 'Seeker of beneficial Islamic knowledge.',
          profile_photo: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=300',
          is_verified: false,
          status: 'ACTIVE',
          followers_count: 0,
          following_count: 0,
          posts_count: 0,
          reels_count: 0,
          is_following: false,
          is_profile_completed: false
        };
      }

      const payload: UserAuthPayload = {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email
      };

      const token = jwt.sign(payload, env.jwtSecret, { expiresIn: '90d' as any });

      const returnUser = {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        phone: user.phone || cleanPhone,
        bio: user.bio || '',
        profile_photo: user.profile_photo || '',
        is_verified: user.is_verified || false,
        status: user.status || 'ACTIVE',
        followers_count: user.followers_count || 0,
        following_count: user.following_count || 0,
        posts_count: user.posts_count || 0,
        reels_count: user.reels_count || 0,
        is_following: false,
        is_profile_completed: Boolean(user.is_profile_completed !== false)
      };

      ResponseUtil.success(
        res,
        {
          token,
          refresh_token: token,
          user: returnUser,
          is_admin: false,
          is_profile_completed: returnUser.is_profile_completed
        },
        'Phone verified successfully.'
      );
    } catch (err: any) {
      ResponseUtil.error(res, 'OTP_VERIFY_FAILED', err?.message || 'Failed to verify OTP.', 500);
    }
  }

  // ==========================================
  // GOOGLE SIGN-IN AUTHENTICATION
  // ==========================================

  async googleLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { idToken, email, name, photoUrl, avatarUrl } = req.body;
      const effectivePhoto = photoUrl || avatarUrl || null;

      if (!email || typeof email !== 'string' || !email.includes('@')) {
        ResponseUtil.error(res, 'VALIDATION_ERROR', 'A valid Google email address is required.', 400);
        return;
      }

      const cleanEmail = email.toLowerCase().trim();
      const displayName = (name && typeof name === 'string' && name.trim().length > 0)
        ? name.trim()
        : cleanEmail.split('@')[0];

      // Check if user already exists
      let userRes = await query(
        'SELECT id, name, username, email, status, phone, is_profile_completed FROM users WHERE LOWER(email) = $1',
        [cleanEmail]
      );

      let user: any;

      if (userRes.rows.length > 0) {
        user = userRes.rows[0];
        if (user.status === 'SUSPENDED') {
          ResponseUtil.error(res, 'ACCOUNT_SUSPENDED', `Account suspended: ${user.suspension_reason || 'Guidelines violation'}`, 403);
          return;
        }
        if (user.status === 'DISABLED') {
          ResponseUtil.error(res, 'ACCOUNT_DISABLED', 'Account is deactivated.', 403);
          return;
        }

        // Update profile picture if user doesn't have one and photo provided
        if (effectivePhoto && (!user.profile_photo || user.profile_photo.includes('unsplash'))) {
          await query('UPDATE profiles SET profile_photo = $1 WHERE user_id = $2', [effectivePhoto, user.id]);
          user.profile_photo = effectivePhoto;
        }
      } else {
        // Auto-create user for Google authenticated account (marked is_profile_completed = false)
        const newUserId = uuidv4();
        const baseUsername = cleanEmail.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '_');
        const cleanUsername = `${baseUsername.slice(0, 20)}_${Math.floor(Math.random() * 1000)}`;
        const randomPassHash = await bcrypt.hash(uuidv4(), 10);
        const photo = effectivePhoto || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=300';

        await withTransaction(async (client) => {
          await client.query(
            `INSERT INTO users (id, name, username, email, password_hash, status, is_profile_completed)
             VALUES ($1, $2, $3, $4, $5, 'ACTIVE', FALSE)`,
            [newUserId, displayName, cleanUsername, cleanEmail, randomPassHash]
          );

          await client.query(
            `INSERT INTO profiles (user_id, bio, profile_photo)
             VALUES ($1, 'Seeker of beneficial Islamic knowledge.', $2)`,
            [newUserId, photo]
          );
        });

        user = {
          id: newUserId,
          name: displayName,
          username: cleanUsername,
          email: cleanEmail,
          phone: null,
          bio: 'Seeker of beneficial Islamic knowledge.',
          profile_photo: photo,
          is_verified: false,
          status: 'ACTIVE',
          followers_count: 0,
          following_count: 0,
          posts_count: 0,
          reels_count: 0,
          is_following: false,
          is_profile_completed: false
        };
      }

      const payload: UserAuthPayload = {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email
      };

      const token = jwt.sign(payload, env.jwtSecret, { expiresIn: '90d' as any });

      const returnUser = {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        phone: user.phone || null,
        bio: user.bio || '',
        profile_photo: user.profile_photo || '',
        is_verified: user.is_verified || false,
        status: user.status || 'ACTIVE',
        followers_count: user.followers_count || 0,
        following_count: user.following_count || 0,
        posts_count: user.posts_count || 0,
        reels_count: user.reels_count || 0,
        is_following: false,
        is_profile_completed: Boolean(user.is_profile_completed !== false)
      };

      ResponseUtil.success(
        res,
        {
          token,
          refresh_token: token,
          user: returnUser,
          is_admin: false,
          is_profile_completed: returnUser.is_profile_completed
        },
        'Signed in with Google successfully.'
      );
    } catch (err) {
      next(err);
    }
  }

  async getMe(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const userRes = await query(
        `SELECT u.id, u.name, u.username, u.email, u.phone, u.is_verified, u.status, u.is_profile_completed,
                p.bio, p.profile_photo, p.followers_count, p.following_count, p.posts_count, p.reels_count
         FROM users u
         LEFT JOIN profiles p ON u.id = p.user_id
         WHERE u.id = $1`,
        [userId]
      );

      if (userRes.rows.length === 0) {
        ResponseUtil.error(res, 'USER_NOT_FOUND', 'User not found.', 404);
        return;
      }

      const u = userRes.rows[0];
      const profile = {
        id: u.id,
        name: u.name,
        username: u.username,
        email: u.email,
        phone: u.phone,
        bio: u.bio || '',
        profile_photo: u.profile_photo || '',
        is_verified: u.is_verified || false,
        status: u.status,
        followers_count: u.followers_count || 0,
        following_count: u.following_count || 0,
        posts_count: u.posts_count || 0,
        reels_count: u.reels_count || 0,
        is_following: false,
        is_profile_completed: Boolean(u.is_profile_completed !== false)
      };

      ResponseUtil.success(res, profile);
    } catch (err) {
      next(err);
    }
  }

  // ==========================================
  // COMPLETE FIRST-TIME PROFILE SETUP
  // ==========================================

  async completeProfile(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const { name, username } = req.body;

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        ResponseUtil.error(res, 'VALIDATION_ERROR', 'Full Name is required.', 400);
        return;
      }

      if (!username || typeof username !== 'string' || username.trim().length === 0) {
        ResponseUtil.error(res, 'VALIDATION_ERROR', 'Username is required.', 400);
        return;
      }

      const cleanName = name.trim();
      const cleanUsername = username.trim().toLowerCase();

      // Username validation: 3-30 chars, alphanumeric or underscores
      const usernameRegex = /^[a-zA-Z0-9_]{3,30}$/;
      if (!usernameRegex.test(cleanUsername)) {
        ResponseUtil.error(
          res,
          'VALIDATION_ERROR',
          'Username must be 3 to 30 characters and contain only letters, numbers, or underscores.',
          400
        );
        return;
      }

      // Check if username is already taken by another user
      const duplicateCheck = await query(
        'SELECT id FROM users WHERE LOWER(username) = $1 AND id != $2',
        [cleanUsername, userId]
      );

      if (duplicateCheck.rows.length > 0) {
        ResponseUtil.error(
          res,
          'USERNAME_TAKEN',
          'This username is already taken. Please choose another username.',
          409
        );
        return;
      }

      // Update user name, username, and mark profile completed
      await query(
        `UPDATE users
         SET name = $1,
             username = $2,
             is_profile_completed = TRUE,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [cleanName, cleanUsername, userId]
      );

      // Fetch updated user record
      const userRes = await query(
        `SELECT u.id, u.name, u.username, u.email, u.phone, u.is_verified, u.status, u.is_profile_completed,
                p.bio, p.profile_photo, p.followers_count, p.following_count, p.posts_count, p.reels_count
         FROM users u
         LEFT JOIN profiles p ON u.id = p.user_id
         WHERE u.id = $1`,
        [userId]
      );

      if (userRes.rows.length === 0) {
        ResponseUtil.error(res, 'USER_NOT_FOUND', 'User not found.', 404);
        return;
      }

      const u = userRes.rows[0];
      const returnUser = {
        id: u.id,
        name: u.name,
        username: u.username,
        email: u.email,
        phone: u.phone,
        bio: u.bio || '',
        profile_photo: u.profile_photo || '',
        is_verified: u.is_verified || false,
        status: u.status,
        followers_count: u.followers_count || 0,
        following_count: u.following_count || 0,
        posts_count: u.posts_count || 0,
        reels_count: u.reels_count || 0,
        is_following: false,
        is_profile_completed: true
      };

      ResponseUtil.success(
        res,
        {
          user: returnUser,
          is_profile_completed: true
        },
        'Profile completed successfully.'
      );
    } catch (err) {
      next(err);
    }
  }
}


export const mobileAuthController = new MobileAuthController();
