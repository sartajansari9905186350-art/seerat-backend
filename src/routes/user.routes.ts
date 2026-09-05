import { Router } from 'express';
import { userController } from '../controllers/user.controller';
import { authenticateAdmin } from '../middleware/auth.middleware';
import { validateBody } from '../middleware/validate';
import { suspendUserSchema, warnUserSchema, banUserSchema } from '../validators/user.validator';

const router = Router();
router.use(authenticateAdmin);

router.get('/', userController.getAll);
router.get('/:id', userController.getById);
router.post('/:id/warn', validateBody(warnUserSchema), userController.warn);
router.post('/:id/suspend', validateBody(suspendUserSchema), userController.suspend);
router.post('/:id/unsuspend', userController.unsuspend);
router.post('/:id/ban', validateBody(banUserSchema), userController.ban);
router.post('/:id/disable', userController.disable);

export default router;
