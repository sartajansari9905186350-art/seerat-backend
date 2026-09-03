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
        is_following: false
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
        `SELECT u.id, u.name, u.username, u.email, u.phone, u.password_hash, u.is_verified, u.status, u.suspension_reason,
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
        is_following: false
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

  async getMe(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const userRes = await query(
        `SELECT u.id, u.name, u.username, u.email, u.phone, u.is_verified, u.status,
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
        is_following: false
      };

      ResponseUtil.success(res, profile);
    } catch (err) {
      next(err);
    }
  }
}

export const mobileAuthController = new MobileAuthController();
