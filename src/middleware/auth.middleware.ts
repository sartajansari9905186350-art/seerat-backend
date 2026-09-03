import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { ResponseUtil } from '../utils/response';
import { AuthTokenPayload } from '../models/admin.model';

export interface AuthenticatedRequest extends Request {
  admin?: AuthTokenPayload;
}

export const authenticateAdmin = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    ResponseUtil.error(res, 'UNAUTHORIZED', 'Access denied. Authorization token required.', 401);
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, env.jwtSecret) as AuthTokenPayload;
    if (!decoded || (decoded.role !== 'SUPER_ADMIN' && decoded.role !== 'MODERATOR')) {
      ResponseUtil.error(res, 'FORBIDDEN', 'Access forbidden. Valid administrative role required.', 403);
      return;
    }
    req.admin = decoded;
    next();
  } catch (err: any) {
    ResponseUtil.error(res, 'SESSION_EXPIRED', 'Session expired or invalid token. Please log in again.', 401);
  }
};

export const requireSuperAdmin = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  if (!req.admin || req.admin.role !== 'SUPER_ADMIN') {
    ResponseUtil.error(res, 'FORBIDDEN', 'Access restricted: Only SUPER_ADMIN can perform this action.', 403);
    return;
  }
  next();
};

export const requireModeratorOrAdmin = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  if (!req.admin || (req.admin.role !== 'SUPER_ADMIN' && req.admin.role !== 'MODERATOR')) {
    ResponseUtil.error(res, 'FORBIDDEN', 'Access denied: Requires Moderator or Super Admin permissions.', 403);
    return;
  }
  next();
};
