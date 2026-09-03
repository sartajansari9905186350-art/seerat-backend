import { Router } from 'express';
import { notificationController } from '../controllers/notification.controller';
import { authenticateAdmin } from '../middleware/auth.middleware';

const router = Router();
router.use(authenticateAdmin);

router.get('/', notificationController.get);
router.post('/read-all', notificationController.markAllRead);
router.post('/:id/read', notificationController.markRead);

export default router;
