import { Router } from 'express';
import { dashboardController } from '../controllers/dashboard.controller';
import { authenticateAdmin } from '../middleware/auth.middleware';

const router = Router();
router.use(authenticateAdmin);

router.get('/', dashboardController.getDashboard);

export default router;
