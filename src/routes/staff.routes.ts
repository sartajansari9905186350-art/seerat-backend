import { Router } from 'express';
import { staffController } from '../controllers/staff.controller';
import { authenticateAdmin, requireSuperAdmin } from '../middleware/auth.middleware';
import { validateBody } from '../middleware/validate';
import { createAdminSchema, updateAdminSchema } from '../validators/user.validator';

const router = Router();
router.use(authenticateAdmin, requireSuperAdmin);

router.get('/', staffController.getAll);
router.post('/', validateBody(createAdminSchema), staffController.create);
router.patch('/:id', validateBody(updateAdminSchema), staffController.update);
router.delete('/:id', staffController.delete);

export default router;
