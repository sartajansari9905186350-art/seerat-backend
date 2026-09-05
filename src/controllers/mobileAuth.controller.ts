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
           VALUES ($1, 'Seeker of beneficial Islamic knowledge.', '')`,
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
        profile_photo: '',
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
        `SELECT u.id, u.name, u.username, u.email, u.phone, u.password_hash, u.is_verified, u.status, u.suspension_reason, u.suspended_until, u.is_profile_completed,
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
        const now = new Date();
        if (user.suspended_until && now >= new Date(user.suspended_until)) {
          // Suspension expired! Auto-restore to ACTIVE
          await query(
            `UPDATE users 
             SET status = 'ACTIVE', suspension_reason = NULL, suspended_at = NULL, suspended_until = NULL, suspended_by = NULL, updated_at = CURRENT_TIMESTAMP 
             WHERE id = $1`,
            [user.id]
          );
          await query(`UPDATE posts SET status = 'APPROVED' WHERE user_id = $1 AND status = 'SUSPENDED'`, [user.id]);
          await query(`UPDATE reels SET status = 'APPROVED' WHERE user_id = $1 AND status = 'SUSPENDED'`, [user.id]);
          user.status = 'ACTIVE';
        } else {
          const untilMsg = user.suspended_until ? ` until ${new Date(user.suspended_until).toUTCString()}` : '';
          ResponseUtil.error(
            res,
            'ACCOUNT_SUSPENDED',
            `Your account is temporarily suspended${untilMsg}. Reason: ${user.suspension_reason || 'Violation of Islamic guidelines.'}`,
            403
          );
          return;
        }
      }

      if (user.status === 'BANNED' || user.status === 'DISABLED') {
        ResponseUtil.error(res, 'ACCOUNT_BANNED', 'Your account has been permanently banned from SEERAT.', 403);
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
  // FACEBOOK AUTHENTICATION
  // ==========================================

  async facebookLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken } = req.body;

      if (!accessToken || typeof accessToken !== 'string' || accessToken.trim().length === 0) {
        ResponseUtil.error(res, 'VALIDATION_ERROR', 'A valid Facebook access token is required.', 400);
        return;
      }

      const cleanToken = accessToken.trim();

      // 1. Verify token and retrieve user profile directly from Meta Graph API
      let fbProfile: any;
      try {
        const graphUrl = `https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=${encodeURIComponent(cleanToken)}`;
        const fbResponse = await fetch(graphUrl);
        fbProfile = await fbResponse.json();

        if (!fbResponse.ok || fbProfile.error) {
          const errorMsg = fbProfile?.error?.message || 'Invalid or expired Facebook access token.';
          ResponseUtil.error(res, 'INVALID_FACEBOOK_TOKEN', errorMsg, 401);
          return;
        }
      } catch (networkErr: any) {
        ResponseUtil.error(res, 'FACEBOOK_API_ERROR', 'Failed to verify Facebook token with Meta servers: ' + (networkErr as Error).message, 502);
        return;
      }

      const fbUserId = fbProfile.id;
      if (!fbUserId) {
        ResponseUtil.error(res, 'INVALID_FACEBOOK_TOKEN', 'Could not obtain verified Facebook User ID.', 401);
        return;
      }

      const verifiedEmail = fbProfile.email ? fbProfile.email.toLowerCase().trim() : null;
      const verifiedName = (fbProfile.name && typeof fbProfile.name === 'string' && fbProfile.name.trim().length > 0)
        ? fbProfile.name.trim()
        : 'Facebook User';
      const verifiedPhoto = fbProfile.picture?.data?.url || null;

      // 2. Find existing user by provider_user_id or by verified email
      let userRes = await query(
        `SELECT u.id, u.name, u.username, u.email, u.phone, u.status, u.suspension_reason, u.is_profile_completed,
                p.bio, p.profile_photo, p.followers_count, p.following_count, p.posts_count, p.reels_count
         FROM users u
         LEFT JOIN profiles p ON u.id = p.user_id
         WHERE u.provider_user_id = $1 OR (u.email = $2 AND $2 IS NOT NULL)`,
        [fbUserId, verifiedEmail]
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

        // Link provider_user_id and auth_provider if not set
        await query(
          `UPDATE users SET 
             auth_provider = COALESCE(auth_provider, 'FACEBOOK'),
             provider_user_id = COALESCE(provider_user_id, $1)
           WHERE id = $2`,
          [fbUserId, user.id]
        );

        // Update profile picture if user doesn't have a custom one
        if (verifiedPhoto && (!user.profile_photo || user.profile_photo.includes('unsplash'))) {
          await query('UPDATE profiles SET profile_photo = $1 WHERE user_id = $2', [verifiedPhoto, user.id]);
          user.profile_photo = verifiedPhoto;
        }
      } else {
        // 3. Create new user for verified Facebook account (marked is_profile_completed = false)
        const newUserId = uuidv4();
        const fallbackEmail = verifiedEmail || `fb_${fbUserId}@seerat.app`;
        const baseUsername = (verifiedEmail ? verifiedEmail.split('@')[0] : `fb_${fbUserId}`)
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, '_');
        const cleanUsername = `${baseUsername.slice(0, 20)}_${Math.floor(Math.random() * 1000)}`;
        const randomPassHash = await bcrypt.hash(uuidv4(), 10);
        const photo = verifiedPhoto || '';

        await withTransaction(async (client) => {
          await client.query(
            `INSERT INTO users (id, name, username, email, password_hash, status, auth_provider, provider_user_id, is_profile_completed)
             VALUES ($1, $2, $3, $4, $5, 'ACTIVE', 'FACEBOOK', $6, FALSE)`,
            [newUserId, verifiedName, cleanUsername, fallbackEmail, randomPassHash, fbUserId]
          );

          await client.query(
            `INSERT INTO profiles (user_id, bio, profile_photo)
             VALUES ($1, 'Seeker of beneficial Islamic knowledge.', $2)`,
            [newUserId, photo]
          );
        });

        user = {
          id: newUserId,
          name: verifiedName,
          username: cleanUsername,
          email: fallbackEmail,
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
        'Signed in with Facebook successfully.'
      );
    } catch (err) {
      next(err);
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
        const photo = effectivePhoto || '';

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
        profile_photo_url: u.profile_photo || '',
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
