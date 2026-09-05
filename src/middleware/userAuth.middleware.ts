import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { ResponseUtil } from '../utils/response';
import { query } from '../config/database';

export interface UserAuthPayload {
  id: string;
  name: string;
  username: string;
  email: string;
}

export interface AuthenticatedUserRequest extends Request {
  user?: UserAuthPayload;
}

export const authenticateUser = async (
  req: AuthenticatedUserRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    ResponseUtil.error(res, 'UNAUTHORIZED', 'Authentication token required.', 401);
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, env.jwtSecret) as UserAuthPayload;
    if (!decoded || !decoded.id) {
      ResponseUtil.error(res, 'UNAUTHORIZED', 'Invalid token payload.', 401);
      return;
    }

    // Verify user is not suspended or disabled/banned
    const userCheck = await query(
      'SELECT status, suspension_reason, suspended_until FROM users WHERE id = $1',
      [decoded.id]
    );
    if (userCheck.rows.length === 0) {
      ResponseUtil.error(res, 'USER_NOT_FOUND', 'User account does not exist.', 404);
      return;
    }

    const dbUser = userCheck.rows[0];

    if (dbUser.status === 'SUSPENDED') {
      const now = new Date();
      if (dbUser.suspended_until && now >= new Date(dbUser.suspended_until)) {
        // Suspension has expired! Automatically restore to ACTIVE
        await query(
          `UPDATE users 
           SET status = 'ACTIVE', suspension_reason = NULL, suspended_at = NULL, suspended_until = NULL, suspended_by = NULL, updated_at = CURRENT_TIMESTAMP 
           WHERE id = $1`,
          [decoded.id]
        );
        await query(`UPDATE posts SET status = 'APPROVED' WHERE user_id = $1 AND status = 'SUSPENDED'`, [decoded.id]);
        await query(`UPDATE reels SET status = 'APPROVED' WHERE user_id = $1 AND status = 'SUSPENDED'`, [decoded.id]);
      } else {
        const untilMsg = dbUser.suspended_until ? ` until ${new Date(dbUser.suspended_until).toUTCString()}` : '';
        ResponseUtil.error(
          res,
          'USER_SUSPENDED',
          `Your account is temporarily suspended${untilMsg}. Reason: ${dbUser.suspension_reason || 'Community guidelines violation.'}`,
          403
        );
        return;
      }
    }

    if (dbUser.status === 'BANNED' || dbUser.status === 'DISABLED') {
      ResponseUtil.error(res, 'USER_BANNED', 'Your account has been permanently banned from SEERAT.', 403);
      return;
    }

    req.user = decoded;
    next();
  } catch (err) {
    ResponseUtil.error(res, 'SESSION_EXPIRED', 'Your session has expired. Please sign in again.', 401);
  }
};

export const optionalUserAuth = async (
  req: AuthenticatedUserRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, env.jwtSecret) as UserAuthPayload;
    if (decoded && decoded.id) {
      req.user = decoded;
    }
  } catch (e) {
    // Ignore invalid optional tokens
  }
  next();
};
