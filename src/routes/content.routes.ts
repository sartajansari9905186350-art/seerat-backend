import { Router } from 'express';
import { contentController } from '../controllers/content.controller';
import { reviewController } from '../controllers/review.controller';
import { authenticateAdmin } from '../middleware/auth.middleware';
import { validateBody } from '../middleware/validate';
import { approveContentSchema, rejectContentSchema, removeContentSchema } from '../validators/content.validator';

const router = Router();
router.use(authenticateAdmin);

router.get('/', contentController.getAll);
router.get('/:id', contentController.getById);
router.post('/:id/approve', validateBody(approveContentSchema), reviewController.approve);
router.post('/:id/reject', validateBody(rejectContentSchema), reviewController.reject);
router.post('/:id/remove', validateBody(removeContentSchema), contentController.remove);
router.post('/:id/restore', contentController.restore);

export default router;
