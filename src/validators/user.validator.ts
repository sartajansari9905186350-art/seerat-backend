import { z } from 'zod';

export const suspendUserSchema = z.object({
  reason: z.string().min(5, 'A clear reason for suspension is required.')
});

export const resolveReportSchema = z.object({
  actionTaken: z.enum(['NONE', 'REMOVED_CONTENT', 'SUSPENDED_USER', 'WARNED_USER', 'DISMISSED']),
  notes: z.string().optional().default('')
});

export const createAdminSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  email: z.string().email('Valid email is required').transform(v => v.toLowerCase().trim()),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(['SUPER_ADMIN', 'MODERATOR'])
});

export const updateAdminSchema = z.object({
  name: z.string().min(2).optional(),
  role: z.enum(['SUPER_ADMIN', 'MODERATOR']).optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional()
});
