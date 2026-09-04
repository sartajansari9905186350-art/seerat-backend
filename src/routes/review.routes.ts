import { Router } from 'express';
import { reviewController } from '../controllers/review.controller';
import { authenticateAdmin } from '../middleware/auth.middleware';
import { validateBody } from '../middleware/validate';
import { approveContentSchema, rejectContentSchema, flagContentSchema } from '../validators/content.validator';

const router = Router();
router.use(authenticateAdmin);

router.get('/', reviewController.getQueue);
router.post('/:id/approve', validateBody(approveContentSchema), reviewController.approve);
router.post('/:id/reject', validateBody(rejectContentSchema), reviewController.reject);
router.post('/:id/flag', validateBody(flagContentSchema), reviewController.flag);

export default router;

