import { Router } from 'express';
import { reportController } from '../controllers/report.controller';
import { authenticateAdmin } from '../middleware/auth.middleware';
import { validateBody } from '../middleware/validate';
import { resolveReportSchema } from '../validators/user.validator';

const router = Router();
router.use(authenticateAdmin);

router.get('/', reportController.getAll);
router.get('/:id', reportController.getById);
router.post('/:id/resolve', validateBody(resolveReportSchema), reportController.resolve);
router.post('/:id/dismiss', reportController.dismiss);

export default router;
