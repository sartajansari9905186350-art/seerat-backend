import { Request, Response, NextFunction } from 'express';
import { ResponseUtil } from '../utils/response';
import { logger } from '../utils/logger';

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  logger.error('Unhandled API Error:', err);

  if (err.message === 'INVALID_CREDENTIALS') {
    ResponseUtil.error(res, 'INVALID_CREDENTIALS', 'Invalid administrative email or password.', 401);
    return;
  }

  if (err.message === 'ACCOUNT_DISABLED') {
    ResponseUtil.error(res, 'ACCOUNT_DISABLED', 'This administrative account is disabled.', 403);
    return;
  }

  if (err.message === 'CONTENT_NOT_FOUND') {
    ResponseUtil.error(res, 'NOT_FOUND', 'Content item not found.', 404);
    return;
  }

  if (err.message === 'USER_NOT_FOUND') {
    ResponseUtil.error(res, 'NOT_FOUND', 'User account not found.', 404);
    return;
  }

  if (err.message === 'REPORT_NOT_FOUND') {
    ResponseUtil.error(res, 'NOT_FOUND', 'Report record not found.', 404);
    return;
  }

  if (err.message === 'EMAIL_EXISTS') {
    ResponseUtil.error(res, 'CONFLICT', 'An administrative account with this email already exists.', 409);
    return;
  }

  if (err.message === 'CANNOT_DISABLE_SELF' || err.message === 'CANNOT_DELETE_SELF') {
    ResponseUtil.error(res, 'BAD_REQUEST', 'You cannot disable or delete your own active administrator account.', 400);
    return;
  }

  // Generic 500
  ResponseUtil.error(
    res,
    'INTERNAL_SERVER_ERROR',
    err.message || 'An internal server error occurred.',
    500
  );
};

