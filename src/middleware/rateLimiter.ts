import rateLimit from 'express-rate-limit';
import { ResponseUtil } from '../utils/response';

// Strict rate limit for login attempts (Brute force protection)
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // Max 15 login attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    ResponseUtil.error(
      res,
      'RATE_LIMIT_EXCEEDED',
      'Too many administrative login attempts. Please try again after 15 minutes.',
      429
    );
  }
});

// General API rate limiter
export const apiRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    ResponseUtil.error(
      res,
      'RATE_LIMIT_EXCEEDED',
      'API rate limit exceeded. Please slow down requests.',
      429
    );
  }
});
