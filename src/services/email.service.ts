import nodemailer, { Transporter, SendMailOptions } from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../utils/logger';

class EmailService {
  private transporter: Transporter | null = null;

  private getTransporter(): Transporter {
    if (!this.transporter) {
      if (!env.smtpUser || !env.smtpPass) {
        throw new Error('SMTP credentials are not configured. Please set SMTP_USER and SMTP_PASS environment variables.');
      }

      const isSecure = env.smtpPort === 465 || env.smtpSecure;

      this.transporter = nodemailer.createTransport({
        host: env.smtpHost,
        port: env.smtpPort,
        secure: isSecure,
        requireTLS: !isSecure, // Requires STARTTLS on port 587
        auth: {
          user: env.smtpUser,
          pass: env.smtpPass
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000
      });
    }
    return this.transporter;
  }

  /**
   * Sends a branded SEERAT password reset email via Resend HTTPS API (Primary)
   */
  async sendPasswordResetEmail(toEmail: string, resetToken: string, recipientName?: string): Promise<boolean> {
    const baseAppUrl = (process.env.APP_URL || env.appUrl || 'https://seerat-backend.onrender.com').trim().replace(/\/+$/, '');
    const resetUrl = `${baseAppUrl}/reset-password/${encodeURIComponent(resetToken)}`;
    const displayName = recipientName?.trim() || 'Valued User';

    const subject = 'SEERAT - Reset Your Account Password';
    const textContent = `Assalamu Alaikum ${displayName},\n\nWe received a request to reset the password for your SEERAT account.\n\nPlease use the following link to set a new password:\n${resetUrl}\n\nThis link is valid for 1 hour and can only be used once.\n\nIf you did not request this, please ignore this message. Your account remains completely secure.\n\nWas-Salam,\nSEERAT Team\nAuthentic Islamic Social & Video Platform`;
    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your SEERAT Password</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f6f8; margin: 0; padding: 0; color: #1f2937; }
    .container { max-width: 580px; margin: 30px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.06); }
    .header { background: linear-gradient(135deg, #064e3b 0%, #047857 100%); padding: 32px 20px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 26px; font-weight: 800; letter-spacing: 4px; }
    .header p { color: #a7f3d0; margin: 6px 0 0 0; font-size: 13px; letter-spacing: 1px; }
    .content { padding: 36px 32px; }
    .greeting { font-size: 17px; font-weight: 600; color: #111827; margin-bottom: 16px; }
    .message { font-size: 15px; line-height: 1.6; color: #4b5563; margin-bottom: 24px; }
    .btn-container { text-align: center; margin: 32px 0; }
    .btn { display: inline-block; background: #047857; color: #ffffff !important; text-decoration: none; padding: 14px 34px; border-radius: 8px; font-size: 15px; font-weight: bold; letter-spacing: 0.5px; box-shadow: 0 4px 10px rgba(4, 120, 87, 0.25); }
    .link-alt { word-break: break-all; font-size: 12px; color: #6b7280; background: #f9fafb; padding: 12px; border-radius: 6px; border: 1px solid #e5e7eb; margin-top: 16px; }
    .security-note { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 0 6px 6px 0; font-size: 13px; color: #92400e; margin-top: 24px; }
    .footer { background: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; }
    .footer p { margin: 4px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>SEERAT</h1>
      <p>Authentic Islamic Platform</p>
    </div>
    <div class="content">
      <div class="greeting">Assalamu Alaikum ${displayName},</div>
      <p class="message">
        We received a request to reset your password for your <strong>SEERAT</strong> account. Click the secure button below to choose a new password:
      </p>
      <div class="btn-container">
        <a href="${resetUrl}" class="btn" target="_blank">Reset Password</a>
      </div>
      <p class="message" style="font-size: 13px; color: #6b7280;">
        If the button above does not work, click or copy this link into your web browser:
      </p>
      <div class="link-alt"><a href="${resetUrl}" style="color: #047857; text-decoration: underline; word-break: break-all;" target="_blank">${resetUrl}</a></div>
      <div class="security-note">
        <strong>Important:</strong> This password reset link is valid for <strong>1 hour</strong> and can only be used once. If you did not request this password reset, you can safely ignore this email; your account remains secure.
      </div>
    </div>
    <div class="footer">
      <p><strong>SEERAT</strong> &bull; Authentic Islamic Social &amp; Video Platform</p>
      <p>This is an automated security notification. Please do not reply directly to this email.</p>
    </div>
  </div>
</body>
</html>
    `;

    // Check for Resend API key dynamically at runtime as well as from env config
    const resendKey = (process.env.RESEND_API_KEY || env.resendApiKey || '').trim();
    const hasResend = resendKey.length > 0;

    logger.info(`[EMAIL_SERVICE] Provider selection: RESEND_CONFIGURED=${hasResend}`);

    // 1. Primary Method: Resend HTTPS REST API (Bypasses Render Free SMTP port blocks)
    if (hasResend) {
      logger.info(`[EMAIL_SERVICE] Initiating password reset delivery | Provider: RESEND_HTTPS`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
        const senderFrom = (process.env.SMTP_FROM || process.env.RESEND_FROM || env.smtpFrom || 'SEERAT <onboarding@resend.dev>').trim();
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: senderFrom,
            to: [toEmail],
            subject: subject,
            text: textContent,
            html: htmlContent
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const data: any = await response.json();
          logger.info(`[EMAIL_SERVICE] Password reset email successfully delivered via Resend HTTPS [MessageId: ${data?.id || 'ok'}]`);
          return true;
        } else {
          const errData: any = await response.json().catch(() => ({}));
          const errMsg = errData?.message || errData?.error || response.statusText || 'Unknown error';
          const errType = errData?.name || 'api_error';
          logger.error(`[EMAIL_SERVICE] Resend response status: ${response.status}`);
          logger.error(`[EMAIL_SERVICE] Resend response: [${errType}] ${errMsg}`);
          throw new Error(`Resend API rejected delivery (${response.status}): ${errMsg}`);
        }
      } catch (fetchErr: any) {
        clearTimeout(timeoutId);
        if (fetchErr.name === 'AbortError') {
          logger.error(`[RESEND_TIMEOUT] Request to Resend API timed out after 10s`);
          throw new Error('Email service request timed out.');
        }
        throw fetchErr;
      }
    }

    // 2. Production Safety: If RESEND_API_KEY is missing, throw configuration error immediately without attempting SMTP
    const isProduction = env.nodeEnv === 'production' || process.env.RENDER === 'true';
    const hasLocalSmtp = Boolean((process.env.SMTP_USER || env.smtpUser) && (process.env.SMTP_PASS || env.smtpPass));

    if (isProduction || !hasLocalSmtp) {
      logger.error('[EMAIL_SERVICE] Password reset delivery halted: RESEND_API_KEY is not configured in environment variables.');
      throw new Error('Email delivery is not configured. Please set RESEND_API_KEY in Render environment variables.');
    }

    // 3. Local Development Fallback Only (Non-production)
    logger.warn(`[EMAIL_SERVICE] Local development fallback: using SMTP (${env.smtpHost}:${env.smtpPort})`);
    const transporter = this.getTransporter();
    const mailOptions: SendMailOptions = {
      from: env.smtpFrom,
      to: toEmail,
      subject: subject,
      text: textContent,
      html: htmlContent
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Password reset email sent via local SMTP to ${toEmail} [MessageId: ${info.messageId}]`);
    return true;
  }

  isResendConfigured(): boolean {
    const key = (process.env.RESEND_API_KEY || env.resendApiKey || '').trim();
    return key.length > 0;
  }

  isSmtpConfigured(): boolean {
    const user = (process.env.SMTP_USER || env.smtpUser || '').trim();
    const pass = (process.env.SMTP_PASS || env.smtpPass || '').trim();
    return user.length > 0 && pass.length > 0;
  }
}

export const emailService = new EmailService();
