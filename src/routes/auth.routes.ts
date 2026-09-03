import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { authenticateAdmin } from '../middleware/auth.middleware';
import { authRateLimiter } from '../middleware/rateLimiter';
import { validateBody } from '../middleware/validate';
import { loginSchema, forgotPasswordSchema } from '../validators/auth.validator';

const router = Router();

router.post('/login', authRateLimiter, validateBody(loginSchema), authController.login);
router.post('/forgot-password', validateBody(forgotPasswordSchema), authController.forgotPassword);
router.get('/me', authenticateAdmin, authController.getMe);
router.post('/logout', authenticateAdmin, authController.logout);

export default router;
