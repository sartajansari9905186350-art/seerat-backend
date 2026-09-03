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

    // Verify user is not suspended or disabled
    const userCheck = await query('SELECT status FROM users WHERE id = $1', [decoded.id]);
    if (userCheck.rows.length === 0) {
      ResponseUtil.error(res, 'USER_NOT_FOUND', 'User account does not exist.', 404);
      return;
    }

    if (userCheck.rows[0].status === 'SUSPENDED') {
      ResponseUtil.error(res, 'USER_SUSPENDED', 'Your account has been suspended for violating SEERAT community guidelines.', 403);
      return;
    }

    if (userCheck.rows[0].status === 'DISABLED') {
      ResponseUtil.error(res, 'USER_DISABLED', 'Your account has been disabled.', 403);
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
