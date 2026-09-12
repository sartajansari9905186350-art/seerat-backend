import { initializeApp, cert, getApps, applicationDefault } from 'firebase-admin/app';
import { getMessaging, MulticastMessage } from 'firebase-admin/messaging';
import fs from 'fs';
import path from 'path';
import { query } from '../config/database';
import { logger } from '../utils/logger';

export interface PushNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

class FcmService {
  private isInitialized = false;

  constructor() {
    this.initFirebase();
  }

  private initFirebase(): void {
    try {
      if (getApps().length > 0) {
        this.isInitialized = true;
        return;
      }

      const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
      const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

      let resolvedPath: string | null = null;
      if (serviceAccountPath) {
        if (path.isAbsolute(serviceAccountPath) && fs.existsSync(serviceAccountPath)) {
          resolvedPath = serviceAccountPath;
        } else if (fs.existsSync(path.resolve(process.cwd(), serviceAccountPath))) {
          resolvedPath = path.resolve(process.cwd(), serviceAccountPath);
        } else if (fs.existsSync(path.resolve(__dirname, '../../', serviceAccountPath))) {
          resolvedPath = path.resolve(__dirname, '../../', serviceAccountPath);
        }
      }

      // Auto-detect secret file in /etc/secrets (Render standard mount) if path not resolved
      if (!resolvedPath && fs.existsSync('/etc/secrets')) {
        try {
          const files = fs.readdirSync('/etc/secrets').filter(f => f.endsWith('.json'));
          if (files.length > 0) {
            const candidate = files.find(f => f.toLowerCase().includes('firebase') || f.toLowerCase().includes('seerat') || f.toLowerCase().includes('service')) || files[0];
            const candidatePath = path.join('/etc/secrets', candidate);
            if (fs.existsSync(candidatePath)) {
              resolvedPath = candidatePath;
              logger.info(`[FCM] Auto-detected Secret File in /etc/secrets: ${candidate}`);
            }
          }
        } catch (_: any) {}
      }

      if (resolvedPath) {
        const fileContent = fs.readFileSync(resolvedPath, 'utf8');
        const serviceAccount = JSON.parse(fileContent);
        initializeApp({
          credential: cert(serviceAccount)
        });
        this.isInitialized = true;
        logger.info('[FCM] Firebase Admin SDK initialized from service account file.');
      } else if (serviceAccountKey) {
        const jsonStr = serviceAccountKey.trim().startsWith('{')
          ? serviceAccountKey
          : Buffer.from(serviceAccountKey, 'base64').toString('utf8');
        const serviceAccount = JSON.parse(jsonStr);
        initializeApp({
          credential: cert(serviceAccount)
        });
        this.isInitialized = true;
        logger.info('[FCM] Firebase Admin SDK initialized from environment JSON string.');
      } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        initializeApp({
          credential: applicationDefault()
        });
        this.isInitialized = true;
        logger.info('[FCM] Firebase Admin SDK initialized with Application Default Credentials.');
      } else {
        logger.info('[FCM] No Firebase service account configured. Operating in simulated/dev notification mode.');
      }
    } catch (err: any) {
      logger.warn('[FCM] Failed to initialize Firebase Admin SDK:', err.message);
      this.isInitialized = false;
    }
  }

  /**
   * Registers or refreshes an FCM device token for a user.
   * If the token was previously registered to another user (device handoff), reassigns it cleanly.
   */
  async registerToken(userId: string, token: string, deviceType: string = 'ANDROID'): Promise<boolean> {
    try {
      if (!token || !userId) return false;

      // 1. Remove this token if it was registered to any other user
      await query(
        'DELETE FROM user_fcm_tokens WHERE token = $1 AND user_id != $2',
        [token, userId]
      );

      // 2. Upsert token for current user
      await query(
        `INSERT INTO user_fcm_tokens (user_id, token, device_type, updated_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id, token) 
         DO UPDATE SET updated_at = CURRENT_TIMESTAMP, device_type = $3`,
        [userId, token, deviceType]
      );

      logger.info(`[FCM] Registered token for user ${userId} (${deviceType})`);
      return true;
    } catch (err: any) {
      logger.error(`[FCM] Error registering token for user ${userId}:`, err.message);
      return false;
    }
  }

  /**
   * Removes a specific FCM device token for a user on logout.
   */
  async removeToken(userId: string, token?: string): Promise<boolean> {
    try {
      if (token) {
        await query(
          'DELETE FROM user_fcm_tokens WHERE user_id = $1 AND token = $2',
          [userId, token]
        );
        logger.info(`[FCM] Removed specific token for user ${userId}`);
      } else {
        // If no specific token passed, delete all tokens for this user
        await query(
          'DELETE FROM user_fcm_tokens WHERE user_id = $1',
          [userId]
        );
        logger.info(`[FCM] Removed all tokens for user ${userId}`);
      }
      return true;
    } catch (err: any) {
      logger.error(`[FCM] Error removing token for user ${userId}:`, err.message);
      return false;
    }
  }

  /**
   * Dispatches push notification to all active devices registered to the target user.
   * Never throws so it does not interfere with the main calling database transaction.
   */
  async sendToUser(userId: string, payload: PushNotificationPayload): Promise<void> {
    try {
      if (!userId) return;

      const res = await query(
        'SELECT token FROM user_fcm_tokens WHERE user_id = $1',
        [userId]
      );

      if (res.rows.length === 0) {
        logger.debug(`[FCM] No registered devices for user ${userId}. Skipping push.`);
        return;
      }

      const tokens: string[] = res.rows.map(r => r.token);

      // Sanitize string data map for FCM payload
      const sanitizedData: Record<string, string> = {};
      if (payload.data) {
        for (const [key, value] of Object.entries(payload.data)) {
          if (value !== undefined && value !== null) {
            sanitizedData[key] = String(value);
          }
        }
      }

      if (!this.isInitialized) {
        logger.info(`[FCM-SIMULATED] User: ${userId}, Tokens: ${tokens.length}, Title: "${payload.title}", Body: "${payload.body}", Data: ${JSON.stringify(sanitizedData)}`);
        return;
      }

      // Send multicast message using Firebase Admin
      const multicastMessage: MulticastMessage = {
        tokens,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: sanitizedData,
        android: {
          priority: 'high',
          notification: {
            channelId: 'seerat_notifications_channel',
            sound: 'default'
          }
        }
      };

      const messaging = getMessaging();
      const response = await messaging.sendEachForMulticast(multicastMessage);
      logger.info(`[FCM] Sent notification to user ${userId}. Success: ${response.successCount}, Failure: ${response.failureCount}`);

      // Prune dead/invalid tokens
      if (response.failureCount > 0) {
        const tokensToRemove: string[] = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            const errCode = resp.error?.code;
            if (
              errCode === 'messaging/invalid-registration-token' ||
              errCode === 'messaging/registration-token-not-registered'
            ) {
              tokensToRemove.push(tokens[idx]);
            }
          }
        });

        if (tokensToRemove.length > 0) {
          logger.info(`[FCM] Pruning ${tokensToRemove.length} inactive tokens for user ${userId}`);
          await query(
            'DELETE FROM user_fcm_tokens WHERE token = ANY($1::text[])',
            [tokensToRemove]
          );
        }
      }
    } catch (err: any) {
      logger.error(`[FCM] Failed to dispatch push notification to user ${userId}:`, err.message);
    }
  }

  public getStatus() {
    let availableSecretFiles: string[] = [];
    if (fs.existsSync('/etc/secrets')) {
      try {
        availableSecretFiles = fs.readdirSync('/etc/secrets');
      } catch (_: any) {}
    }
    return {
      is_initialized: this.isInitialized,
      configured_path: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || null,
      available_secret_files: availableSecretFiles,
    };
  }
}

export const fcmService = new FcmService();
