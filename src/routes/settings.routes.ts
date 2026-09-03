import { Router } from 'express';
import { settingsController } from '../controllers/settings.controller';
import { authenticateAdmin, requireSuperAdmin } from '../middleware/auth.middleware';

const router = Router();
router.use(authenticateAdmin);

router.get('/', settingsController.get);
router.patch('/', requireSuperAdmin, settingsController.update);

export default router;
