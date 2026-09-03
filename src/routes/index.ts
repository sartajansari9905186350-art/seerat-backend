import { Router } from 'express';
import authRoutes from './auth.routes';
import dashboardRoutes from './dashboard.routes';
import reviewRoutes from './review.routes';
import contentRoutes from './content.routes';
import userRoutes from './user.routes';
import reportRoutes from './report.routes';
import staffRoutes from './staff.routes';
import auditRoutes from './audit.routes';
import settingsRoutes from './settings.routes';
import notificationRoutes from './notification.routes';

const router = Router();

// Mount all Admin endpoints
router.use('/auth', authRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/review-queue', reviewRoutes);
router.use('/content', contentRoutes);
router.use('/users', userRoutes);
router.use('/reports', reportRoutes);
router.use('/admins', staffRoutes);
router.use('/audit-logs', auditRoutes);
router.use('/settings', settingsRoutes);
router.use('/notifications', notificationRoutes);

export default router;
