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

      this.transporter = nodemailer.createTransport({
        host: env.smtpHost,
        port: env.smtpPort,
        secure: env.smtpSecure,
        auth: {
          user: env.smtpUser,
          pass: env.smtpPass
        },
        tls: {
          rejectUnauthorized: false
        }
      });
    }
    return this.transporter;
  }

  /**
   * Sends a branded SEERAT password reset email
   */
  async sendPasswordResetEmail(toEmail: string, resetToken: string, recipientName?: string): Promise<boolean> {
    const transporter = this.getTransporter();

    const resetUrl = `${env.appUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;
    const displayName = recipientName?.trim() || 'Valued User';

    const mailOptions: SendMailOptions = {
      from: env.smtpFrom,
      to: toEmail,
      subject: 'SEERAT - Reset Your Account Password',
      text: `Assalamu Alaikum ${displayName},\n\nWe received a request to reset the password for your SEERAT account.\n\nPlease use the following link to set a new password:\n${resetUrl}\n\nThis link is valid for 1 hour and can only be used once.\n\nIf you did not request this, please ignore this message. Your account remains completely secure.\n\nWas-Salam,\nSEERAT Team\nAuthentic Islamic Social & Video Platform`,
      html: `
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
        If the button above does not work, copy and paste this link into your web browser:
      </p>
      <div class="link-alt">${resetUrl}</div>
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
      `
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Password reset email successfully sent to ${toEmail} [MessageId: ${info.messageId}]`);
    return true;
  }
}

export const emailService = new EmailService();
