import express, { Express } from 'express';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import adminRouter from './routes/index';
import { mobileRouter } from './routes/mobile.routes';
import { apiRateLimiter } from './middleware/rateLimiter';
import { errorHandler } from './middleware/errorHandler';
import { env } from './config/env';
import { logger } from './utils/logger';
import { query } from './config/database';
import { ResponseUtil } from './utils/response';
import { fcmService } from './services/fcm.service';
import { b2Storage } from './services/b2Storage.service';
import { getDefaultThumbnailBuffer } from './assets/defaultThumbnail';

const app: Express = express();

// Security Headers - explicitly allow cross-origin media access
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }
}));

// CORS Policy with Range headers support
app.use(cors({
  origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(','),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Range', 'X-Requested-With'],
  exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length']
}));

// Request Logging
app.use(morgan('combined', { stream: { write: (msg: string) => logger.info(msg.trim()) } }));

// Rate Limiting
app.use('/api/', apiRateLimiter);

// Body Parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/api/health', async (_req, res) => {
  try {
    await query('SELECT 1 as healthy');

    ResponseUtil.success(res, {
      status: 'healthy',
      database: 'connected',
      b2: {
        is_configured: b2Storage.isConfigured(),
        bucket: env.b2BucketName
      }
    });
  } catch (err: any) {
    ResponseUtil.error(res, 'DB_ERROR', 'Database connectivity error', 500, err.message);
  }
});

// Public endpoint to serve uploaded profile photos (from persistent PostgreSQL storage)
app.get('/api/uploads/profile-photos/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const cleanFilename = path.basename(filename);
    const result = await query(
      'SELECT mime_type, image_data FROM profile_photo_blobs WHERE filename = $1',
      [cleanFilename]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Photo not found' });
    }
    const { mime_type, image_data } = result.rows[0];
    res.set('Content-Type', mime_type || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400, immutable');
    res.send(image_data);
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error retrieving photo' });
  }
});

// Public endpoint to serve the official SEERAT brand logo (used for OpenGraph fallback and branding)
app.get(['/assets/logo.png', '/api/assets/logo.png', '/logo.png'], (_req, res) => {
  const possiblePaths = [
    path.join(__dirname, 'assets', 'logo.png'),
    path.join(__dirname, '../src/assets', 'logo.png'),
    path.join(process.cwd(), 'src/assets/logo.png'),
    path.join(process.cwd(), 'dist/src/assets/logo.png')
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      res.set({
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400, immutable',
        'Access-Control-Allow-Origin': '*'
      });
      return res.sendFile(p);
    }
  }
  const defaultThumb = getDefaultThumbnailBuffer();
  res.set({
    'Content-Type': 'image/png',
    'Cache-Control': 'public, max-age=86400, immutable',
    'Access-Control-Allow-Origin': '*'
  });
  return res.send(defaultThumb);
});

// Public endpoint to serve lightweight thumbnail images (prevents Coil from downloading full MP4s)
app.get('/api/uploads/thumbnails/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const cleanFilename = path.basename(filename);

    // Default / fallback branded thumbnail
    if (cleanFilename === 'default.jpg' || cleanFilename === 'default.png' || cleanFilename.startsWith('default')) {
      const buffer = getDefaultThumbnailBuffer();
      res.set({
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400, immutable',
        'Access-Control-Allow-Origin': '*'
      });
      return res.send(buffer);
    }

    // Check if thumbnail exists in Backblaze B2
    if (b2Storage.isConfigured()) {
      const b2Key = `thumbnails/${cleanFilename}`;
      const hasThumb = await b2Storage.hasObject(b2Key);
      if (hasThumb) {
        const streamed = await b2Storage.streamObject(b2Key, undefined, res);
        if (streamed) {
          return;
        }
      }
    }

    // Check persistent database fallback if thumbnail was stored in video_blobs
    try {
      const blobRes = await query('SELECT video_data, mime_type FROM video_blobs WHERE filename = $1', [cleanFilename]);
      if (blobRes.rows.length > 0) {
        res.set({
          'Content-Type': blobRes.rows[0].mime_type || 'image/jpeg',
          'Cache-Control': 'public, max-age=86400, immutable',
          'Access-Control-Allow-Origin': '*'
        });
        return res.send(blobRes.rows[0].video_data);
      }
    } catch (_: any) {}

    // Fallback: Return branded lightweight Islamic poster image
    const fallbackBuffer = getDefaultThumbnailBuffer();
    res.set({
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400, immutable',
      'Access-Control-Allow-Origin': '*'
    });
    return res.send(fallbackBuffer);
  } catch (err: any) {
    logger.error(`Error retrieving thumbnail ${req.params.filename}:`, err.message);
    const fallbackBuffer = getDefaultThumbnailBuffer();
    res.set({
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400, immutable',
      'Access-Control-Allow-Origin': '*'
    });
    res.send(fallbackBuffer);
  }
});

// Public HEAD endpoint for video probe requests (ExoPlayer & Browsers)
app.head('/api/uploads/videos/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const cleanFilename = path.basename(filename);

    if (b2Storage.isConfigured()) {
      const b2Key = `videos/${cleanFilename}`;
      const meta = await b2Storage.getObjectMetadata(b2Key);
      if (meta) {
        res.status(200).set({
          'Accept-Ranges': 'bytes',
          'Content-Type': meta.contentType || 'video/mp4',
          'Content-Length': meta.size.toString(),
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
          'Cross-Origin-Resource-Policy': 'cross-origin',
          'Cache-Control': 'public, max-age=31536000, immutable'
        }).end();
        return;
      }
    }

    const metaResult = await query(
      'SELECT file_size, mime_type FROM video_blobs WHERE filename = $1',
      [cleanFilename]
    );

    if (metaResult.rows.length) {
      const totalSize = parseInt(metaResult.rows[0].file_size, 10);
      const mimeType = metaResult.rows[0].mime_type || 'video/mp4';
      res.status(200).set({
        'Accept-Ranges': 'bytes',
        'Content-Type': mimeType,
        'Content-Length': totalSize.toString(),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Cache-Control': 'public, max-age=31536000, immutable'
      }).end();
      return;
    }

    res.status(404).end();
  } catch (err: any) {
    res.status(500).end();
  }
});

// Public endpoint for video streaming with full HTTP Range (206 Partial Content) support
app.get('/api/uploads/videos/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const cleanFilename = path.basename(filename);

    // 1. Primary: Stream directly from Backblaze B2 if object exists (Zero Supabase database egress, zero extra HeadObject latency)
    if (b2Storage.isConfigured()) {
      const b2Key = `videos/${cleanFilename}`;
      const streamed = await b2Storage.streamObject(b2Key, req.headers.range, res);
      if (streamed) {
        return;
      }
    }

    // 2. Legacy Fallback: Stream from PostgreSQL video_blobs table
    const metaResult = await query(
      'SELECT file_size, mime_type FROM video_blobs WHERE filename = $1',
      [cleanFilename]
    );

    if (!metaResult.rows.length) {
      return res.status(404).json({ success: false, message: 'Video file not found' });
    }

    const totalSize = parseInt(metaResult.rows[0].file_size, 10);
    const mimeType = metaResult.rows[0].mime_type || 'video/mp4';

    const range = req.headers.range;

    if (range) {
      // Byte Range Request (ExoPlayer & HTML5 video seek/stream)
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);

      // If client specified an explicit end, use it; otherwise stream to end of file
      let end: number;
      if (parts[1] && parts[1].trim() !== '') {
        end = parseInt(parts[1], 10);
      } else {
        end = totalSize - 1;
      }
      if (end >= totalSize) {
        end = totalSize - 1;
      }

      if (isNaN(start) || start >= totalSize || start < 0 || start > end) {
        res.status(416).set('Content-Range', `bytes */${totalSize}`).send();
        return;
      }

      const totalBytesToSend = (end - start) + 1;

      res.status(206);
      res.set({
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': totalBytesToSend.toString(),
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=31536000, immutable'
      });

      // Stream in 1MB chunks to keep memory usage low while streaming complete range
      const CHUNK_SIZE = 1024 * 1024; // 1 MB
      let current = start;
      let isAborted = false;

      req.on('close', () => {
        isAborted = true;
      });

      while (current <= end && !isAborted && !res.writableEnded) {
        const nextLen = Math.min(CHUNK_SIZE, (end - current) + 1);
        const sqlStart = current + 1; // PostgreSQL substring is 1-indexed

        const chunkResult = await query(
          'SELECT substring(video_data FROM $1 FOR $2) as chunk FROM video_blobs WHERE filename = $3',
          [sqlStart, nextLen, cleanFilename]
        );

        if (!chunkResult.rows.length || !chunkResult.rows[0].chunk) {
          break;
        }

        const chunk = chunkResult.rows[0].chunk;
        const canContinue = res.write(chunk);
        if (!canContinue && !isAborted) {
          await new Promise<void>((resolve) => {
            res.once('drain', () => resolve());
            req.once('close', () => resolve());
          });
        }
        current += nextLen;
      }

      if (!res.writableEnded) {
        res.end();
      }
    } else {
      // Full Video Request
      const fullResult = await query(
        'SELECT video_data FROM video_blobs WHERE filename = $1',
        [cleanFilename]
      );

      if (!fullResult.rows.length) {
        return res.status(404).json({ success: false, message: 'Video not found' });
      }

      res.status(200);
      res.set({
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Content-Length': totalSize.toString(),
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000, immutable'
      });
      res.send(fullResult.rows[0].video_data);
    }
  } catch (err: any) {
    logger.error(`Error streaming video ${req.params.filename}:`, err.message);
    res.status(500).json({ success: false, message: 'Error streaming video' });
  }
});

// ==========================================
// PUBLIC WEB: PASSWORD RESET PAGE
// ==========================================
app.get('/reset-password', async (req, res) => {
  const token = req.query.token as string || '';
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Password - SEERAT</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #f8fafc;
      color: #0f172a;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #ffffff;
      width: 100%;
      max-width: 440px;
      border-radius: 20px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.02);
      border: 1px solid #e2e8f0;
      padding: 36px 32px;
      text-align: center;
    }
    .brand-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 60px;
      height: 60px;
      background: linear-gradient(135deg, #064e3b 0%, #047857 100%);
      color: #ffffff;
      font-size: 26px;
      font-weight: 800;
      border-radius: 16px;
      margin-bottom: 16px;
      box-shadow: 0 6px 16px rgba(4, 120, 87, 0.25);
    }
    h1 { font-size: 22px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px; margin-bottom: 8px; }
    p.subtitle { font-size: 14px; color: #64748b; margin-bottom: 28px; line-height: 1.5; }
    .form-group { text-align: left; margin-bottom: 18px; }
    label { display: block; font-size: 13px; font-weight: 600; color: #334155; margin-bottom: 6px; }
    .input-wrapper { position: relative; }
    input {
      width: 100%;
      padding: 12px 14px;
      border: 1.5px solid #cbd5e1;
      border-radius: 10px;
      font-size: 14px;
      font-family: inherit;
      color: #0f172a;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    input:focus {
      border-color: #047857;
      box-shadow: 0 0 0 3px rgba(4, 120, 87, 0.15);
    }
    .btn {
      width: 100%;
      padding: 13px 20px;
      background: #047857;
      color: #ffffff;
      border: none;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      margin-top: 10px;
      transition: background 0.2s, transform 0.1s;
    }
    .btn:hover { background: #065f46; }
    .btn:active { transform: scale(0.99); }
    .btn:disabled { background: #94a3b8; cursor: not-allowed; }
    .alert {
      padding: 12px 16px;
      border-radius: 10px;
      font-size: 13.5px;
      line-height: 1.4;
      margin-bottom: 20px;
      text-align: left;
    }
    .alert-error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
    .alert-success { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
    .footer-text { margin-top: 24px; font-size: 12px; color: #94a3b8; }
    #loadingState { display: block; }
    #formState { display: none; }
    #successState { display: none; }
    #errorState { display: none; }
    .spinner {
      border: 3px solid #e2e8f0;
      border-top: 3px solid #047857;
      border-radius: 50%;
      width: 32px;
      height: 32px;
      animation: spin 0.8s linear infinite;
      margin: 20px auto;
    }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand-badge">S</div>
    <h1>SEERAT</h1>

    <div id="loadingState">
      <div class="spinner"></div>
      <p class="subtitle">Verifying your secure password reset link...</p>
    </div>

    <div id="errorState">
      <div class="alert alert-error" id="errorMsg">This password reset link is invalid or has expired.</div>
      <p class="subtitle">Please open the SEERAT app and request a new password reset link.</p>
    </div>

    <div id="successState">
      <div class="alert alert-success">
        <strong>Alhamdulillah!</strong> Your password has been successfully reset.
      </div>
      <p class="subtitle">You can now open the SEERAT app and sign in with your new password.</p>
    </div>

    <div id="formState">
      <p class="subtitle" id="userGreeting">Create a new secure password for your account.</p>
      
      <div id="formAlert" style="display:none;" class="alert alert-error"></div>

      <form id="resetForm" onsubmit="handleReset(event)">
        <div class="form-group">
          <label for="newPassword">New Password</label>
          <input type="password" id="newPassword" placeholder="Minimum 6 characters" required minlength="6">
        </div>
        <div class="form-group">
          <label for="confirmPassword">Confirm New Password</label>
          <input type="password" id="confirmPassword" placeholder="Re-enter password" required minlength="6">
        </div>
        <button type="submit" class="btn" id="submitBtn">Update Password</button>
      </form>
    </div>

    <div class="footer-text">SEERAT &bull; Authentic Islamic Platform</div>
  </div>

  <script>
    const token = ${JSON.stringify(token)};
    
    async function init() {
      if (!token) {
        showError('No reset token provided in link.');
        return;
      }

      try {
        const res = await fetch('/api/auth/verify-reset-token?token=' + encodeURIComponent(token));
        const data = await res.json();
        if (res.ok && data.success) {
          document.getElementById('loadingState').style.display = 'none';
          document.getElementById('formState').style.display = 'block';
          if (data.data && data.data.name) {
            document.getElementById('userGreeting').textContent = 'Assalamu Alaikum, ' + data.data.name + '. Set your new password below:';
          }
        } else {
          showError(data.message || 'This reset link is invalid or has expired.');
        }
      } catch (err) {
        showError('Network error connecting to SEERAT server. Please check your connection.');
      }
    }

    function showError(msg) {
      document.getElementById('loadingState').style.display = 'none';
      document.getElementById('formState').style.display = 'none';
      document.getElementById('errorState').style.display = 'block';
      document.getElementById('errorMsg').textContent = msg;
    }

    async function handleReset(e) {
      e.preventDefault();
      const p1 = document.getElementById('newPassword').value;
      const p2 = document.getElementById('confirmPassword').value;
      const alertBox = document.getElementById('formAlert');
      const submitBtn = document.getElementById('submitBtn');

      if (p1.length < 6) {
        alertBox.textContent = 'Password must be at least 6 characters.';
        alertBox.style.display = 'block';
        return;
      }

      if (p1 !== p2) {
        alertBox.textContent = 'Passwords do not match. Please ensure both fields are identical.';
        alertBox.style.display = 'block';
        return;
      }

      alertBox.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Updating...';

      try {
        const res = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token, newPassword: p1 })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          document.getElementById('formState').style.display = 'none';
          document.getElementById('successState').style.display = 'block';
        } else {
          alertBox.textContent = data.message || 'Failed to reset password. Please try again.';
          alertBox.style.display = 'block';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Update Password';
        }
      } catch (err) {
        alertBox.textContent = 'Server connection error. Please try again.';
        alertBox.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Update Password';
      }
    }

    init();
  </script>
</body>
</html>`);
});

// Helper to safely escape HTML entities and prevent XSS
function escapeHtml(str: any): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Helper to resolve public photo URL without exposing private B2/internal credentials
function resolvePublicPhotoUrl(rawPhoto: string | null | undefined): string {
  const fallbackLogo = 'https://seerat-backend.onrender.com/assets/logo.png';
  if (!rawPhoto || typeof rawPhoto !== 'string') return fallbackLogo;
  const trimmed = rawPhoto.trim();
  if (!trimmed) return fallbackLogo;
  if (trimmed.includes('backblazeb2.com') || trimmed.includes('b2_') || trimmed.includes('seerat-media')) {
    return fallbackLogo;
  }
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return trimmed;
  }
  if (trimmed.startsWith('/')) {
    return `https://seerat-backend.onrender.com${trimmed}`;
  }
  return fallbackLogo;
}

// ==========================================
// PUBLIC WEB: SEERAT PROFILE LINK WITH OPENGRAPH
// ==========================================
app.get('/u/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const cleanUsername = (username || '').toLowerCase().trim();

    const result = await query(
      `SELECT u.id, u.name, u.username, p.bio, p.profile_photo,
              COALESCE(p.followers_count, 0) as followers_count,
              COALESCE(p.posts_count, 0) as posts_count,
              COALESCE(p.reels_count, 0) as reels_count
       FROM users u
       LEFT JOIN profiles p ON u.id = p.user_id
       WHERE LOWER(u.username) = $1`,
      [cleanUsername]
    );

    if (result.rows.length === 0) {
      const safeUser = escapeHtml(cleanUsername);
      return res.status(404).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>User Not Found – SEERAT</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: #f8fafc;
      color: #0f172a;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      text-align: center;
    }
    .card {
      background: #ffffff;
      border-radius: 20px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.06);
      padding: 40px 28px;
      max-width: 380px;
      width: 100%;
      border: 1px solid #e2e8f0;
    }
    h1 { font-size: 20px; color: #dc2626; margin-bottom: 8px; font-weight: 700; }
    p { color: #64748b; font-size: 14px; margin-bottom: 24px; line-height: 1.5; }
    .btn { display: inline-block; padding: 12px 24px; background: #047857; color: #fff; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Profile Not Found</h1>
    <p>The profile @${safeUser} does not exist on SEERAT.</p>
    <a href="https://seerat-backend.onrender.com" class="btn">Return to SEERAT</a>
  </div>
</body>
</html>`);
    }

    const u = result.rows[0];
    const rawDisplayName = (u.name && u.name.trim()) ? u.name.trim() : (u.username || cleanUsername);
    const rawUsername = u.username || cleanUsername;
    const rawBio = (u.bio && u.bio.trim()) ? u.bio.trim() : 'Seeker of beneficial Islamic knowledge & authentic reminders on SEERAT.';
    const publicPhotoUrl = resolvePublicPhotoUrl(u.profile_photo);
    const hasCustomPhoto = Boolean(u.profile_photo && publicPhotoUrl !== 'https://seerat-backend.onrender.com/assets/logo.png');

    const followersCount = Number(u.followers_count || 0);
    const postsCount = Number(u.posts_count || 0);
    const deepLink = `seerat://user/${encodeURIComponent(u.id)}`;
    const publicProfileUrl = `https://seerat-backend.onrender.com/u/${encodeURIComponent(rawUsername)}`;

    // Escaped variables for safe HTML injection
    const escDisplayName = escapeHtml(rawDisplayName);
    const escUsername = escapeHtml(rawUsername);
    const escBio = escapeHtml(rawBio);
    const escPhotoUrl = escapeHtml(publicPhotoUrl);
    const escProfileUrl = escapeHtml(publicProfileUrl);
    const escDeepLink = escapeHtml(deepLink);

    const ogTitle = `${escDisplayName} (@${escUsername}) – SEERAT`;
    const ogDescription = escBio;
    const ogImage = escPhotoUrl;
    const ogUrl = escProfileUrl;

    const avatarHtml = hasCustomPhoto
      ? `<img src="${escPhotoUrl}" class="avatar" alt="${escDisplayName}" onerror="this.onerror=null;this.src='https://seerat-backend.onrender.com/assets/logo.png';">`
      : `<div class="avatar-placeholder">${escDisplayName.charAt(0).toUpperCase()}</div>`;

    let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${ogTitle}</title>

  <!-- OpenGraph Meta Tags for Rich Social Previews (WhatsApp, Telegram, Facebook, Twitter) -->
  <meta property="og:site_name" content="SEERAT">
  <meta property="og:type" content="profile">
  <meta property="og:title" content="${ogTitle}">
  <meta property="og:description" content="${ogDescription}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:url" content="${ogUrl}">

  <!-- Twitter / X Card Meta Tags -->
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${ogTitle}">
  <meta name="twitter:description" content="${ogDescription}">
  <meta name="twitter:image" content="${ogImage}">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #f8fafc;
      color: #0f172a;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
    }
    .card {
      background: #ffffff;
      width: 100%;
      max-width: 400px;
      border-radius: 24px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.05);
      border: 1px solid #e2e8f0;
      padding: 36px 24px;
      text-align: center;
    }
    .avatar {
      width: 96px;
      height: 96px;
      border-radius: 50%;
      object-fit: cover;
      margin: 0 auto 16px;
      border: 3px solid #047857;
      box-shadow: 0 4px 14px rgba(4, 120, 87, 0.18);
      display: block;
    }
    .avatar-placeholder {
      width: 96px;
      height: 96px;
      border-radius: 50%;
      background: #047857;
      color: #ffffff;
      font-size: 36px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 16px;
      box-shadow: 0 4px 14px rgba(4, 120, 87, 0.18);
    }
    h1 {
      font-size: 22px;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 3px;
      letter-spacing: -0.3px;
    }
    .username {
      font-size: 14px;
      font-weight: 600;
      color: #047857;
      margin-bottom: 14px;
    }
    .bio {
      font-size: 14px;
      color: #475569;
      line-height: 1.55;
      margin-bottom: 22px;
      word-wrap: break-word;
    }
    .stats {
      display: flex;
      justify-content: space-around;
      background: #f8fafc;
      border: 1px solid #edf2f7;
      border-radius: 14px;
      padding: 14px 10px;
      margin-bottom: 24px;
    }
    .stat-item {
      flex: 1;
      text-align: center;
    }
    .stat-num {
      font-size: 17px;
      font-weight: 800;
      color: #0f172a;
    }
    .stat-label {
      font-size: 11px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 2px;
    }
    .btn {
      display: block;
      width: 100%;
      padding: 14px 20px;
      background: #047857;
      color: #ffffff !important;
      text-decoration: none;
      border-radius: 14px;
      font-size: 15px;
      font-weight: 700;
      box-shadow: 0 4px 12px rgba(4, 120, 87, 0.25);
      transition: background 0.2s, transform 0.1s;
    }
    .btn:hover {
      background: #065f46;
    }
    .footer-note {
      margin-top: 22px;
      font-size: 12px;
      font-weight: 600;
      color: #94a3b8;
      letter-spacing: 0.3px;
    }
  </style>
</head>
<body>
  <div class="card">
    ${avatarHtml}
    <h1>${escDisplayName}</h1>
    <div class="username">@${escUsername}</div>
    <div class="bio">${escBio}</div>

    <div class="stats">
      <div class="stat-item">
        <div class="stat-num">${followersCount.toLocaleString()}</div>
        <div class="stat-label">Followers</div>
      </div>
      <div class="stat-item">
        <div class="stat-num">${postsCount.toLocaleString()}</div>
        <div class="stat-label">Posts</div>
      </div>
    </div>

    <a href="${escDeepLink}" class="btn">View Profile on SEERAT</a>
    <div class="footer-note">SEERAT &bull; Authentic Islamic Platform</div>
  </div>
</body>
</html>`;

    // Safety check: NEVER expose JavaScript/template expressions in final HTML sent to browser
    if (html.includes('${')) {
      logger.error('CRITICAL: Template expression detected in rendered HTML!');
      html = html.replace(/\$\{.*?\}/g, '');
    }

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err: any) {
    logger.error('Error loading profile share page:', err);
    res.status(500).send('<!DOCTYPE html><html><body><h3>Unable to load profile at this time. Please try again later.</h3></body></html>');
  }
});

// ==========================================
// PUBLIC WEB: SEERAT POST LINK WITH OPENGRAPH
// ==========================================
app.get(['/p/:postId', '/api/posts/:postId/share'], async (req, res) => {
  try {
    const postId = (req.params.postId || '').trim();

    const result = await query(
      `SELECT p.id, p.content_type, p.text_content, p.arabic_text, p.translation_text, p.reference_source,
              COALESCE(p.likes_count, 0) as likes_count,
              COALESCE(p.comments_count, 0) as comments_count,
              COALESCE(p.shares_count, 0) as shares_count,
              p.created_at,
              u.id as creator_id, u.name as creator_name, u.username as creator_username,
              prof.profile_photo as creator_photo,
              c.name as category_name,
              m.url as media_url, m.thumbnail_url
       FROM posts p
       JOIN users u ON p.user_id = u.id
       LEFT JOIN profiles prof ON u.id = prof.user_id
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN media m ON p.media_id = m.id
       WHERE p.id = $1`,
      [postId]
    );

    if (result.rows.length === 0) {
      return res.status(404).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Post Not Found – SEERAT</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: #f8fafc; color: #0f172a; min-height: 100vh;
      display: flex; align-items: center; justify-content: center; padding: 20px; text-align: center;
    }
    .card {
      background: #ffffff; border-radius: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.06);
      padding: 40px 28px; max-width: 380px; width: 100%; border: 1px solid #e2e8f0;
    }
    h1 { font-size: 20px; color: #dc2626; margin-bottom: 8px; font-weight: 700; }
    p { color: #64748b; font-size: 14px; margin-bottom: 24px; line-height: 1.5; }
    .btn { display: inline-block; padding: 12px 24px; background: #047857; color: #fff; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Post Not Found</h1>
    <p>This Islamic post is no longer available or does not exist.</p>
    <a href="https://seerat-backend.onrender.com" class="btn">Return to SEERAT</a>
  </div>
</body>
</html>`);
    }

    const p = result.rows[0];
    const rawTitle = (p.arabic_text && p.arabic_text.trim()) ? p.arabic_text.trim() : '';
    const rawCaption = (p.text_content && p.text_content.trim())
      ? p.text_content.trim()
      : ((p.translation_text && p.translation_text.trim()) ? p.translation_text.trim() : '');
    const rawCategory = (p.category_name && p.category_name.trim()) ? p.category_name.trim() : 'Islamic';
    const rawReference = (p.reference_source && p.reference_source.trim()) ? p.reference_source.trim() : '';
    const rawCreatorName = (p.creator_name && p.creator_name.trim()) ? p.creator_name.trim() : (p.creator_username || 'SEERAT Creator');
    const rawCreatorUsername = p.creator_username || 'seerat';
    const creatorPhotoUrl = resolvePublicPhotoUrl(p.creator_photo);
    const mediaPhotoUrl = resolvePublicPhotoUrl(p.thumbnail_url || p.media_url);

    const publicPostUrl = `https://seerat-backend.onrender.com/p/${encodeURIComponent(p.id)}`;
    const deepLink = `seerat://post/${encodeURIComponent(p.id)}`;

    const escTitle = escapeHtml(rawTitle);
    const escCaption = escapeHtml(rawCaption);
    const escCategory = escapeHtml(rawCategory);
    const escReference = escapeHtml(rawReference);
    const escCreatorName = escapeHtml(rawCreatorName);
    const escCreatorUsername = escapeHtml(rawCreatorUsername);
    const escCreatorPhoto = escapeHtml(creatorPhotoUrl);
    const escMediaPhoto = escapeHtml(mediaPhotoUrl);
    const escPublicUrl = escapeHtml(publicPostUrl);
    const escDeepLink = escapeHtml(deepLink);

    const ogTitle = rawTitle ? `${escTitle} – SEERAT` : `Post by ${escCreatorName} (@${escCreatorUsername}) – SEERAT`;
    const ogDescription = escCaption ? escCaption.slice(0, 200) : `Authentic Islamic reminder shared from SEERAT.`;
    const ogImage = escMediaPhoto;

    const hasMedia = Boolean(p.media_url || p.thumbnail_url);
    const isVideo = p.content_type === 'VIDEO';

    let mediaHtml = '';
    if (hasMedia) {
      if (isVideo) {
        const publicVideoUrl = resolvePublicPhotoUrl(p.media_url);
        const escVideoUrl = escapeHtml(publicVideoUrl);
        mediaHtml = `<div class="media-container"><video controls poster="${escMediaPhoto}" class="post-video"><source src="${escVideoUrl}" type="video/mp4"></video></div>`;
      } else {
        mediaHtml = `<div class="media-container"><img src="${escMediaPhoto}" class="post-image" alt="SEERAT Post" onerror="this.onerror=null;this.src='https://seerat-backend.onrender.com/assets/logo.png';"></div>`;
      }
    }

    let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${ogTitle}</title>

  <!-- OpenGraph Meta Tags for Rich Social Previews (WhatsApp, Telegram, Facebook, Twitter) -->
  <meta property="og:site_name" content="SEERAT">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${ogTitle}">
  <meta property="og:description" content="${ogDescription}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:url" content="${escPublicUrl}">

  <!-- Twitter / X Card Meta Tags -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${ogTitle}">
  <meta name="twitter:description" content="${ogDescription}">
  <meta name="twitter:image" content="${ogImage}">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Amiri:wght@700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #f8fafc; color: #0f172a; min-height: 100vh;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 24px 16px;
    }
    .card {
      background: #ffffff; width: 100%; max-width: 440px; border-radius: 24px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.05); border: 1px solid #e2e8f0;
      padding: 24px; overflow: hidden;
    }
    .brand-bar {
      display: flex; align-items: center; gap: 8px; margin-bottom: 18px; padding-bottom: 12px;
      border-bottom: 1px solid #f1f5f9;
    }
    .brand-logo { width: 26px; height: 26px; border-radius: 6px; }
    .brand-name { font-weight: 800; font-size: 14px; color: #047857; letter-spacing: 0.5px; }
    .creator-row { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    .creator-avatar { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; border: 2px solid #047857; }
    .creator-meta { display: flex; flex-direction: column; }
    .creator-name { font-weight: 700; font-size: 15px; color: #0f172a; }
    .creator-username { font-size: 13px; font-weight: 600; color: #047857; }
    .content-title {
      font-family: 'Amiri', serif; font-size: 20px; font-weight: 700; color: #065f46;
      margin-bottom: 12px; line-height: 1.5; direction: rtl; text-align: right;
    }
    .content-caption {
      font-size: 15px; line-height: 1.6; color: #334155; margin-bottom: 16px;
      white-space: pre-wrap; word-break: break-word;
    }
    .media-container { margin: 14px 0; border-radius: 16px; overflow: hidden; background: #000; }
    .post-image { width: 100%; max-height: 380px; object-fit: cover; display: block; }
    .post-video { width: 100%; max-height: 380px; display: block; background: #000; }
    .badges-row { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; }
    .badge {
      font-size: 12px; font-weight: 600; padding: 5px 12px; border-radius: 8px;
    }
    .badge-category { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
    .badge-ref { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }
    .btn {
      display: block; width: 100%; padding: 14px 20px; background: #047857;
      color: #ffffff !important; text-decoration: none; border-radius: 14px;
      font-size: 15px; font-weight: 700; text-align: center;
      box-shadow: 0 4px 12px rgba(4, 120, 87, 0.25); margin-top: 12px;
    }
    .btn:hover { background: #065f46; }
    .footer-note {
      margin-top: 18px; font-size: 12px; font-weight: 600; color: #94a3b8;
      text-align: center; letter-spacing: 0.3px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand-bar">
      <img src="https://seerat-backend.onrender.com/assets/logo.png" class="brand-logo" alt="SEERAT">
      <span class="brand-name">SEERAT</span>
    </div>

    <div class="creator-row">
      <img src="${escCreatorPhoto}" class="creator-avatar" alt="${escCreatorName}" onerror="this.onerror=null;this.src='https://seerat-backend.onrender.com/assets/logo.png';">
      <div class="creator-meta">
        <span class="creator-name">${escCreatorName}</span>
        <span class="creator-username">@${escCreatorUsername}</span>
      </div>
    </div>

    ${rawTitle ? `<div class="content-title">${escTitle}</div>` : ''}
    ${rawCaption ? `<div class="content-caption">${escCaption}</div>` : ''}
    ${mediaHtml}

    <div class="badges-row">
      <span class="badge badge-category">Category: ${escCategory}</span>
      ${rawReference ? `<span class="badge badge-ref">Reference: ${escReference}</span>` : ''}
    </div>

    <a href="${escDeepLink}" class="btn">Open in SEERAT App</a>
    <div class="footer-note">Shared from SEERAT &bull; Authentic Islamic Platform</div>
  </div>
</body>
</html>`;

    if (html.includes('${')) {
      logger.error('CRITICAL: Template expression detected in rendered HTML!');
      html = html.replace(/\$\{.*?\}/g, '');
    }

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err: any) {
    logger.error('Error loading post share page:', err);
    res.status(500).send('<!DOCTYPE html><html><body><h3>Unable to load post at this time. Please try again later.</h3></body></html>');
  }
});

// ==========================================
// PUBLIC WEB: SEERAT REEL LINK WITH OPENGRAPH
// ==========================================
app.get(['/r/:reelId', '/api/reels/:reelId/share'], async (req, res) => {
  try {
    const reelId = (req.params.reelId || '').trim();

    const result = await query(
      `SELECT r.id, r.caption, r.reference_source, r.audio_title, r.audio_artist,
              COALESCE(r.likes_count, 0) as likes_count,
              COALESCE(r.comments_count, 0) as comments_count,
              COALESCE(r.shares_count, 0) as shares_count,
              COALESCE(r.views_count, 0) as views_count,
              r.created_at,
              u.id as creator_id, u.name as creator_name, u.username as creator_username,
              prof.profile_photo as creator_photo,
              c.name as category_name,
              m.url as video_url, m.thumbnail_url
       FROM reels r
       JOIN users u ON r.user_id = u.id
       LEFT JOIN profiles prof ON u.id = prof.user_id
       LEFT JOIN categories c ON r.category_id = c.id
       LEFT JOIN media m ON r.media_id = m.id
       WHERE r.id = $1`,
      [reelId]
    );

    if (result.rows.length === 0) {
      return res.status(404).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reel Not Found – SEERAT</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: #f8fafc; color: #0f172a; min-height: 100vh;
      display: flex; align-items: center; justify-content: center; padding: 20px; text-align: center;
    }
    .card {
      background: #ffffff; border-radius: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.06);
      padding: 40px 28px; max-width: 380px; width: 100%; border: 1px solid #e2e8f0;
    }
    h1 { font-size: 20px; color: #dc2626; margin-bottom: 8px; font-weight: 700; }
    p { color: #64748b; font-size: 14px; margin-bottom: 24px; line-height: 1.5; }
    .btn { display: inline-block; padding: 12px 24px; background: #047857; color: #fff; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Reel Not Found</h1>
    <p>This Islamic reel is no longer available or does not exist.</p>
    <a href="https://seerat-backend.onrender.com" class="btn">Return to SEERAT</a>
  </div>
</body>
</html>`);
    }

    const r = result.rows[0];
    const rawTitle = (r.audio_title && r.audio_title.trim() && r.audio_title !== 'Original Islamic Audio')
      ? r.audio_title.trim()
      : '';
    const rawCaption = (r.caption && r.caption.trim()) ? r.caption.trim() : '';
    const rawCategory = (r.category_name && r.category_name.trim()) ? r.category_name.trim() : 'Islamic';
    const rawReference = (r.reference_source && r.reference_source.trim()) ? r.reference_source.trim() : '';
    const rawCreatorName = (r.creator_name && r.creator_name.trim()) ? r.creator_name.trim() : (r.creator_username || 'SEERAT Creator');
    const rawCreatorUsername = r.creator_username || 'seerat';
    const creatorPhotoUrl = resolvePublicPhotoUrl(r.creator_photo);
    const posterUrl = resolvePublicPhotoUrl(r.thumbnail_url);
    const videoUrl = resolvePublicPhotoUrl(r.video_url);

    const publicReelUrl = `https://seerat-backend.onrender.com/r/${encodeURIComponent(r.id)}`;
    const deepLink = `seerat://reel/${encodeURIComponent(r.id)}`;

    const escTitle = escapeHtml(rawTitle);
    const escCaption = escapeHtml(rawCaption);
    const escCategory = escapeHtml(rawCategory);
    const escReference = escapeHtml(rawReference);
    const escCreatorName = escapeHtml(rawCreatorName);
    const escCreatorUsername = escapeHtml(rawCreatorUsername);
    const escCreatorPhoto = escapeHtml(creatorPhotoUrl);
    const escPosterUrl = escapeHtml(posterUrl);
    const escVideoUrl = escapeHtml(videoUrl);
    const escPublicUrl = escapeHtml(publicReelUrl);
    const escDeepLink = escapeHtml(deepLink);

    const ogTitle = rawTitle ? `${escTitle} – Reel by ${escCreatorName}` : `Reel by ${escCreatorName} (@${escCreatorUsername}) – SEERAT`;
    const ogDescription = escCaption ? escCaption.slice(0, 200) : `Watch authentic Islamic reel on SEERAT.`;
    const ogImage = escPosterUrl;

    let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${ogTitle}</title>

  <!-- OpenGraph Meta Tags for Rich Social Previews (WhatsApp, Telegram, Facebook, Twitter) -->
  <meta property="og:site_name" content="SEERAT">
  <meta property="og:type" content="video.other">
  <meta property="og:title" content="${ogTitle}">
  <meta property="og:description" content="${ogDescription}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:url" content="${escPublicUrl}">

  <!-- Twitter / X Card Meta Tags -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${ogTitle}">
  <meta name="twitter:description" content="${ogDescription}">
  <meta name="twitter:image" content="${ogImage}">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #0f172a; color: #f8fafc; min-height: 100vh;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 24px 16px;
    }
    .card {
      background: #1e293b; width: 100%; max-width: 440px; border-radius: 24px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4); border: 1px solid #334155;
      padding: 24px; overflow: hidden;
    }
    .brand-bar {
      display: flex; align-items: center; gap: 8px; margin-bottom: 18px; padding-bottom: 12px;
      border-bottom: 1px solid #334155;
    }
    .brand-logo { width: 26px; height: 26px; border-radius: 6px; }
    .brand-name { font-weight: 800; font-size: 14px; color: #34d399; letter-spacing: 0.5px; }
    .creator-row { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    .creator-avatar { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; border: 2px solid #059669; }
    .creator-meta { display: flex; flex-direction: column; }
    .creator-name { font-weight: 700; font-size: 15px; color: #f8fafc; }
    .creator-username { font-size: 13px; font-weight: 600; color: #34d399; }
    .content-title {
      font-size: 17px; font-weight: 700; color: #f8fafc; margin-bottom: 10px; line-height: 1.4;
    }
    .content-caption {
      font-size: 14px; line-height: 1.6; color: #cbd5e1; margin-bottom: 16px;
      white-space: pre-wrap; word-break: break-word;
    }
    .media-container {
      margin: 14px 0; border-radius: 16px; overflow: hidden; background: #000;
      position: relative; display: flex; justify-content: center;
    }
    .reel-video { width: 100%; max-height: 480px; display: block; border-radius: 16px; background: #000; }
    .badges-row { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; }
    .badge {
      font-size: 12px; font-weight: 600; padding: 5px 12px; border-radius: 8px;
    }
    .badge-category { background: rgba(5, 150, 105, 0.2); color: #34d399; border: 1px solid rgba(5, 150, 105, 0.4); }
    .badge-ref { background: rgba(100, 116, 139, 0.2); color: #94a3b8; border: 1px solid #475569; }
    .btn {
      display: block; width: 100%; padding: 14px 20px; background: #059669;
      color: #ffffff !important; text-decoration: none; border-radius: 14px;
      font-size: 15px; font-weight: 700; text-align: center;
      box-shadow: 0 4px 14px rgba(5, 150, 105, 0.4); margin-top: 12px;
    }
    .btn:hover { background: #047857; }
    .footer-note {
      margin-top: 18px; font-size: 12px; font-weight: 600; color: #64748b;
      text-align: center; letter-spacing: 0.3px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand-bar">
      <img src="https://seerat-backend.onrender.com/assets/logo.png" class="brand-logo" alt="SEERAT">
      <span class="brand-name">SEERAT</span>
    </div>

    <div class="creator-row">
      <img src="${escCreatorPhoto}" class="creator-avatar" alt="${escCreatorName}" onerror="this.onerror=null;this.src='https://seerat-backend.onrender.com/assets/logo.png';">
      <div class="creator-meta">
        <span class="creator-name">${escCreatorName}</span>
        <span class="creator-username">@${escCreatorUsername}</span>
      </div>
    </div>

    ${rawTitle ? `<div class="content-title">${escTitle}</div>` : ''}
    ${rawCaption ? `<div class="content-caption">${escCaption}</div>` : ''}

    <div class="media-container">
      <video controls poster="${escPosterUrl}" class="reel-video" preload="metadata">
        <source src="${escVideoUrl}" type="video/mp4">
        Your browser does not support the video tag.
      </video>
    </div>

    <div class="badges-row">
      <span class="badge badge-category">Category: ${escCategory}</span>
      ${rawReference ? `<span class="badge badge-ref">Reference: ${escReference}</span>` : ''}
    </div>

    <a href="${escDeepLink}" class="btn">Watch on SEERAT App</a>
    <div class="footer-note">Shared from SEERAT &bull; Authentic Islamic Platform</div>
  </div>
</body>
</html>`;

    if (html.includes('${')) {
      logger.error('CRITICAL: Template expression detected in rendered HTML!');
      html = html.replace(/\$\{.*?\}/g, '');
    }

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err: any) {
    logger.error('Error loading reel share page:', err);
    res.status(500).send('<!DOCTYPE html><html><body><h3>Unable to load reel at this time. Please try again later.</h3></body></html>');
  }
});

// Web-based Password Reset Page (served to users who click the email reset link)
app.get('/reset-password', async (req, res) => {
  try {
    const rawToken = (req.query.token as string) || '';
    const cleanToken = rawToken.replace(/[^a-zA-Z0-9]/g, '');

    // Check if token exists and is valid
    let initialError = '';
    let targetUsername = '';

    if (!cleanToken) {
      initialError = 'Invalid or missing password reset token. Please request a new link from the SEERAT app.';
    } else {
      const tokenRes = await query(
        `SELECT pr.id, pr.expires_at, pr.used_at, u.username, u.name
         FROM password_resets pr
         JOIN users u ON pr.user_id = u.id
         WHERE pr.token = $1`,
        [cleanToken]
      );

      if (tokenRes.rows.length === 0) {
        initialError = 'This password reset link is invalid or does not exist.';
      } else {
        const record = tokenRes.rows[0];
        if (record.used_at !== null) {
          initialError = 'This password reset link has already been used. Please request a new one from the SEERAT app.';
        } else if (new Date(record.expires_at).getTime() < Date.now()) {
          initialError = 'This password reset link has expired. Please request a new one from the SEERAT app.';
        } else {
          targetUsername = record.username || record.name || '';
        }
      }
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Password - SEERAT</title>
  <link rel="icon" type="image/png" href="https://seerat-backend.onrender.com/assets/logo.png">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: #090d16;
      color: #f8fafc;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px 16px;
    }
    .card {
      width: 100%;
      max-width: 440px;
      background: #111827;
      border: 1px solid #1f2937;
      border-radius: 20px;
      padding: 32px 28px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
    }
    .brand-header {
      text-align: center;
      margin-bottom: 28px;
    }
    .brand-logo {
      width: 60px;
      height: 60px;
      border-radius: 14px;
      margin-bottom: 12px;
    }
    .brand-title {
      font-size: 22px;
      font-weight: 800;
      color: #10b981;
      letter-spacing: 3px;
      margin-bottom: 4px;
    }
    .brand-subtitle {
      font-size: 13px;
      color: #9ca3af;
    }
    .form-group {
      margin-bottom: 20px;
    }
    .form-label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: #e5e7eb;
      margin-bottom: 8px;
    }
    .input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }
    .form-input {
      width: 100%;
      padding: 13px 44px 13px 14px;
      background: #1f2937;
      border: 1.5px solid #374151;
      border-radius: 10px;
      color: #ffffff;
      font-size: 15px;
      outline: none;
      transition: border-color 0.2s;
    }
    .form-input:focus {
      border-color: #10b981;
    }
    .toggle-pwd {
      position: absolute;
      right: 12px;
      background: none;
      border: none;
      color: #9ca3af;
      cursor: pointer;
      font-size: 13px;
      padding: 4px;
    }
    .toggle-pwd:hover { color: #f3f4f6; }
    .btn-submit {
      width: 100%;
      padding: 14px;
      background: #047857;
      color: #ffffff;
      font-size: 15px;
      font-weight: 700;
      border: none;
      border-radius: 10px;
      cursor: pointer;
      transition: background 0.2s, opacity 0.2s;
      margin-top: 8px;
    }
    .btn-submit:hover { background: #059669; }
    .btn-submit:disabled { opacity: 0.6; cursor: not-allowed; }
    .alert-error {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.4);
      color: #f87171;
      padding: 12px 14px;
      border-radius: 10px;
      font-size: 13px;
      margin-bottom: 20px;
      line-height: 1.4;
    }
    .success-box {
      text-align: center;
      padding: 10px 0;
    }
    .success-icon {
      width: 56px;
      height: 56px;
      background: rgba(16, 185, 129, 0.2);
      border: 2px solid #10b981;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 16px;
      color: #10b981;
      font-size: 28px;
      font-weight: bold;
    }
    .success-title {
      font-size: 18px;
      font-weight: 700;
      color: #f9fafb;
      margin-bottom: 8px;
    }
    .success-desc {
      font-size: 14px;
      color: #9ca3af;
      line-height: 1.5;
      margin-bottom: 24px;
    }
    .btn-open-app {
      display: inline-block;
      width: 100%;
      padding: 13px;
      background: #10b981;
      color: #ffffff;
      text-decoration: none;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 700;
      text-align: center;
    }
    .footer-note {
      text-align: center;
      font-size: 12px;
      color: #6b7280;
      margin-top: 24px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand-header">
      <img src="https://seerat-backend.onrender.com/assets/logo.png" class="brand-logo" alt="SEERAT">
      <div class="brand-title">SEERAT</div>
      <div class="brand-subtitle">Reset Your Account Password</div>
    </div>

    <div id="errorAlert" class="alert-error" style="${initialError ? 'display: block;' : 'display: none;'}">${initialError}</div>

    ${initialError ? `
      <div style="text-align: center; margin-top: 16px;">
        <a href="seerat://login" class="btn-open-app">Open SEERAT App</a>
      </div>
    ` : `
      <div id="resetFormContainer">
        ${targetUsername ? `<div style="font-size: 13px; color: #9ca3af; margin-bottom: 16px; text-align: center;">Resetting password for: <strong style="color: #34d399;">@${targetUsername}</strong></div>` : ''}
        <form id="resetForm" onsubmit="handleReset(event)">
          <input type="hidden" id="tokenInput" value="${cleanToken}">
          
          <div class="form-group">
            <label class="form-label" for="newPassword">New Password (min 6 characters)</label>
            <div class="input-wrapper">
              <input type="password" id="newPassword" class="form-input" required minlength="6" placeholder="Enter new password" autocomplete="new-password">
              <button type="button" class="toggle-pwd" onclick="toggleVisibility('newPassword', this)">Show</button>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="confirmPassword">Confirm New Password</label>
            <div class="input-wrapper">
              <input type="password" id="confirmPassword" class="form-input" required minlength="6" placeholder="Re-enter new password" autocomplete="new-password">
              <button type="button" class="toggle-pwd" onclick="toggleVisibility('confirmPassword', this)">Show</button>
            </div>
          </div>

          <button type="submit" id="submitBtn" class="btn-submit">Update Password</button>
        </form>
      </div>

      <div id="successContainer" class="success-box" style="display: none;">
        <div class="success-icon">&#10003;</div>
        <div class="success-title">Password Reset Complete!</div>
        <div class="success-desc">Your password has been successfully updated. You can now log into the SEERAT mobile app with your new password.</div>
        <a href="seerat://login" class="btn-open-app">Open SEERAT App</a>
      </div>
    `}

    <div class="footer-note">SEERAT &bull; Authentic Islamic Social &amp; Video Platform</div>
  </div>

  <script>
    function toggleVisibility(fieldId, btn) {
      var field = document.getElementById(fieldId);
      if (field.type === 'password') {
        field.type = 'text';
        btn.textContent = 'Hide';
      } else {
        field.type = 'password';
        btn.textContent = 'Show';
      }
    }

    async function handleReset(e) {
      e.preventDefault();
      var token = document.getElementById('tokenInput').value;
      var newPassword = document.getElementById('newPassword').value;
      var confirmPassword = document.getElementById('confirmPassword').value;
      var errorAlert = document.getElementById('errorAlert');
      var submitBtn = document.getElementById('submitBtn');

      errorAlert.style.display = 'none';

      if (newPassword !== confirmPassword) {
        errorAlert.textContent = 'Passwords do not match. Please verify both fields.';
        errorAlert.style.display = 'block';
        return;
      }

      if (newPassword.length < 6) {
        errorAlert.textContent = 'Password must be at least 6 characters long.';
        errorAlert.style.display = 'block';
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Updating password...';

      try {
        var resp = await fetch('/api/mobile/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token, newPassword: newPassword })
        });
        var data = await resp.json();

        if (resp.ok && data.success) {
          document.getElementById('resetFormContainer').style.display = 'none';
          document.getElementById('successContainer').style.display = 'block';
        } else {
          errorAlert.textContent = data.message || (data.error && data.error.message) || 'Failed to reset password. Please try again.';
          errorAlert.style.display = 'block';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Update Password';
        }
      } catch (err) {
        errorAlert.textContent = 'Network error. Please check your internet connection and try again.';
        errorAlert.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Update Password';
      }
    }
  </script>
</body>
</html>`;

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err: any) {
    logger.error('Error rendering reset password page:', err);
    res.status(500).send('<!DOCTYPE html><html><body><h3>Unable to load password reset page. Please try again later.</h3></body></html>');
  }
});

// Mount Admin REST API
app.use('/api/admin', adminRouter);

// Mount Mobile App REST API
app.use('/api', mobileRouter);

// Centralized Error Handling
app.use(errorHandler);

export default app;
