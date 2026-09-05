import multer from 'multer';
import { Request, Response, NextFunction } from 'express';
import { ResponseUtil } from '../utils/response';

// Keep uploaded files in memory buffer (ephemeral Render filesystem safety)
const storage = multer.memoryStorage();

const ALLOWED_MIMES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/pjpeg',
  'image/x-png'
];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

export const uploadProfilePhotoMulter = multer({
  storage,
  limits: {
    fileSize: MAX_SIZE
  },
  fileFilter: (req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase();
    const ext = (file.originalname || '').toLowerCase();
    const hasValidExt = ['.jpg', '.jpeg', '.png', '.webp'].some(e => ext.endsWith(e));
    const hasValidMime = ALLOWED_MIMES.some(m => mime.includes(m.replace('image/', '')));

    if (hasValidMime || hasValidExt || mime.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('INVALID_FILE_TYPE'));
    }
  }
}).fields([
  { name: 'photo', maxCount: 1 },
  { name: 'avatar', maxCount: 1 },
  { name: 'image', maxCount: 1 },
  { name: 'file', maxCount: 1 }
]);

export const handlePhotoUpload = (req: Request, res: Response, next: NextFunction) => {
  uploadProfilePhotoMulter(req, res, (err: any) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return ResponseUtil.error(res, 'FILE_TOO_LARGE', 'Profile photo exceeds maximum allowed size of 5 MB.', 400);
      }
      if (err.message === 'INVALID_FILE_TYPE') {
        return ResponseUtil.error(res, 'INVALID_FILE_TYPE', 'Unsupported file type. Please upload a JPG, JPEG, PNG, or WEBP image.', 400);
      }
      return ResponseUtil.error(res, 'UPLOAD_ERROR', err.message || 'File upload failed.', 400);
    }

    // Normalize req.file from any of the allowed multipart field names
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    if (files) {
      req.file = files['photo']?.[0] || files['avatar']?.[0] || files['image']?.[0] || files['file']?.[0];
    }

    next();
  });
};

const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50 MB
const ALLOWED_VIDEO_MIMES = [
  'video/mp4',
  'video/quicktime',
  'video/x-matroska',
  'video/webm',
  'video/3gpp',
  'video/avi',
  'video/x-msvideo',
  'video/x-m4v',
  'video/m4v'
];

export const uploadVideoMulter = multer({
  storage,
  limits: {
    fileSize: MAX_VIDEO_SIZE
  },
  fileFilter: (req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase();
    const ext = (file.originalname || '').toLowerCase();
    const hasValidExt = ['.mp4', '.mov', '.mkv', '.webm', '.3gp', '.avi', '.m4v'].some(e => ext.endsWith(e));
    const hasValidMime = ALLOWED_VIDEO_MIMES.some(m => mime.includes(m.replace('video/', '')));

    if (hasValidMime || hasValidExt || mime.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('INVALID_VIDEO_TYPE'));
    }
  }
}).fields([
  { name: 'video', maxCount: 1 },
  { name: 'reel', maxCount: 1 },
  { name: 'file', maxCount: 1 },
  { name: 'media', maxCount: 1 }
]);

export const handleVideoUpload = (req: Request, res: Response, next: NextFunction) => {
  uploadVideoMulter(req, res, (err: any) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return ResponseUtil.error(res, 'FILE_TOO_LARGE', 'Video exceeds maximum allowed size of 50 MB.', 400);
      }
      if (err.message === 'INVALID_VIDEO_TYPE') {
        return ResponseUtil.error(res, 'INVALID_VIDEO_TYPE', 'Unsupported video format. Please upload an authentic MP4, MOV, M4V, or WEBM video.', 400);
      }
      return ResponseUtil.error(res, 'UPLOAD_ERROR', err.message || 'Video upload failed.', 400);
    }

    // Normalize req.file from any of the allowed multipart field names
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    if (files) {
      req.file = files['video']?.[0] || files['reel']?.[0] || files['file']?.[0] || files['media']?.[0];
    }

    next();
  });
};
