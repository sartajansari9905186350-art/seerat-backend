import { z } from 'zod';

export const rejectContentSchema = z.object({
  contentType: z.enum(['POST', 'REEL']),
  rejectionReason: z.enum([
    'Not Islamic content',
    'Incorrect information',
    'Copyright issue',
    'Inappropriate content',
    'Spam',
    'Misleading information',
    'Other'
  ], {
    errorMap: () => ({ message: 'A valid Islamic moderation rejection reason is required.' })
  }),
  customNotes: z.string().optional().default('')
});

export const approveContentSchema = z.object({
  contentType: z.enum(['POST', 'REEL']),
  notes: z.string().optional().default('')
});

export const removeContentSchema = z.object({
  contentType: z.enum(['POST', 'REEL']),
  reason: z.string().min(3, 'Removal reason is required').optional().default('Removed by administrator')
});
