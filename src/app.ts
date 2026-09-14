import express, { Express } from 'express';
import path from 'path';
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

// ==========================================
// PUBLIC WEB: SEERAT PROFILE LINK WITH OPENGRAPH
// ==========================================
app.get('/u/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const cleanUsername = (username || '').toLowerCase().trim();

    const result = await query(
      `SELECT u.id, u.name, u.username, p.bio, p.profile_photo, p.followers_count, p.posts_count, p.reels_count
       FROM users u
       LEFT JOIN profiles p ON u.id = p.user_id
       WHERE LOWER(u.username) = $1`,
      [cleanUsername]
    );

    if (result.rows.length === 0) {
      return res.status(404).send(`<!DOCTYPE html>
<html><head><title>User Not Found - SEERAT</title></head>
<body style="font-family:sans-serif; text-align:center; padding:50px;">
  <h2>User Not Found</h2>
  <p>The profile @\${cleanUsername} does not exist on SEERAT.</p>
</body></html>`);
    }

    const u = result.rows[0];
    const displayName = u.name || cleanUsername;
    const bioText = u.bio || 'Follow on SEERAT - Authentic Islamic Platform for Quran, Hadith, Bayan & Islamic Reminders.';
    const photo = u.profile_photo || 'https://seerat-backend.onrender.com/api/uploads/thumbnails/default.jpg';
    const profileUrl = `https://seerat-backend.onrender.com/u/\${u.username}`;
    const deepLink = `seerat://user/\${u.id}`;

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>\${displayName} (@\${u.username}) &bull; SEERAT</title>
  
  <!-- OpenGraph Meta Tags for Rich Social Previews (WhatsApp, Telegram, Facebook, Twitter) -->
  <meta property="og:type" content="profile">
  <meta property="og:title" content="\${displayName} (@\${u.username}) on SEERAT">
  <meta property="og:description" content="\${bioText}">
  <meta property="og:image" content="\${photo}">
  <meta property="og:url" content="\${profileUrl}">
  <meta property="og:site_name" content="SEERAT">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="\${displayName} (@\${u.username})">
  <meta name="twitter:description" content="\${bioText}">
  <meta name="twitter:image" content="\${photo}">

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
      padding: 20px;
    }
    .card {
      background: #ffffff;
      width: 100%;
      max-width: 420px;
      border-radius: 24px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.05);
      border: 1px solid #e2e8f0;
      padding: 36px 28px;
      text-align: center;
    }
    .avatar {
      width: 100px;
      height: 100px;
      border-radius: 50%;
      object-fit: cover;
      margin: 0 auto 16px;
      border: 3px solid #047857;
      box-shadow: 0 4px 12px rgba(4, 120, 87, 0.2);
    }
    .avatar-placeholder {
      width: 100px;
      height: 100px;
      border-radius: 50%;
      background: #047857;
      color: #fff;
      font-size: 36px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 16px;
    }
    h1 { font-size: 20px; font-weight: 800; color: #0f172a; margin-bottom: 2px; }
    .username { font-size: 14px; font-weight: 600; color: #047857; margin-bottom: 12px; }
    .bio { font-size: 13.5px; color: #475569; line-height: 1.5; margin-bottom: 20px; word-wrap: break-word; }
    .stats {
      display: flex;
      justify-content: space-around;
      background: #f8fafc;
      border-radius: 12px;
      padding: 12px;
      margin-bottom: 24px;
    }
    .stat-num { font-size: 16px; font-weight: 800; color: #0f172a; }
    .stat-label { font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; }
    .btn {
      display: block;
      width: 100%;
      padding: 14px;
      background: #047857;
      color: #ffffff !important;
      text-decoration: none;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 700;
      transition: background 0.2s;
    }
    .btn:hover { background: #065f46; }
    .footer-note { margin-top: 20px; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="card">
    \${u.profile_photo ? '<img src="' + photo + '" class="avatar" alt="' + displayName + '">' : '<div class="avatar-placeholder">' + displayName.charAt(0).toUpperCase() + '</div>'}
    <h1>\${displayName}</h1>
    <div class="username">@\${u.username}</div>
    <div class="bio">\${bioText}</div>

    <div class="stats">
      <div>
        <div class="stat-num">\${u.followers_count || 0}</div>
        <div class="stat-label">Followers</div>
      </div>
      <div>
        <div class="stat-num">\${u.posts_count || 0}</div>
        <div class="stat-label">Posts</div>
      </div>
      <div>
        <div class="stat-num">\${u.reels_count || 0}</div>
        <div class="stat-label">Reels</div>
      </div>
    </div>

    <a href="\${deepLink}" class="btn">View Profile on SEERAT</a>
    <div class="footer-note">SEERAT &bull; Authentic Islamic Platform</div>
  </div>

  <script>
    // If app is installed, attempt immediate deep link redirect
    setTimeout(() => {
      window.location.href = "\${deepLink}";
    }, 300);
  </script>
</body>
</html>`);
  } catch (err: any) {
    res.status(500).send("Error loading profile");
  }
});

// Mount Admin REST API
app.use('/api/admin', adminRouter);

// Mount Mobile App REST API
app.use('/api', mobileRouter);

// Centralized Error Handling
app.use(errorHandler);

export default app;
