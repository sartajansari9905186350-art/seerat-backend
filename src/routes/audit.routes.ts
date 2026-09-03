import { Router } from 'express';
import { auditController } from '../controllers/audit.controller';
import { authenticateAdmin } from '../middleware/auth.middleware';

const router = Router();
router.use(authenticateAdmin);

router.get('/', auditController.getAll);

export default router;
