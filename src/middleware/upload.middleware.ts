import multer from 'multer';
import { Request, Response, NextFunction } from 'express';
import { ResponseUtil } from '../utils/response';

// Keep uploaded files in memory buffer (ephemeral Render filesystem safety)
const storage = multer.memoryStorage();

const ALLOWED_MIMES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

export const uploadProfilePhotoMulter = multer({
  storage,
  limits: {
    fileSize: MAX_SIZE
  },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIMES.includes(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('INVALID_FILE_TYPE'));
    }
  }
}).single('photo');

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
    next();
  });
};
