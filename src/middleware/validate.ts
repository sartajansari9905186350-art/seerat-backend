import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { ResponseUtil } from '../utils/response';

export const validateBody = (schema: ZodSchema) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      req.body = await schema.parseAsync(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const firstIssue = err.issues[0];
        ResponseUtil.error(
          res,
          'VALIDATION_ERROR',
          firstIssue ? firstIssue.message : 'Invalid request payload',
          400,
          err.issues
        );
        return;
      }
      ResponseUtil.error(res, 'BAD_REQUEST', 'Malformed request body', 400);
    }
  };
};
