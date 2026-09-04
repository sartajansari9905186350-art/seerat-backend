import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { adminRepository } from '../repositories/admin.repository';
import { auditRepository } from '../repositories/audit.repository';
import { env } from '../config/env';
import { AdminProfileDTO, AuthTokenPayload } from '../models/admin.model';

export class AuthService {
  async login(
    email: string,
    passwordPlain: string,
    rememberMe: boolean = false,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ token: string; admin: AdminProfileDTO }> {
    const admin = await adminRepository.findByEmail(email);
    if (!admin) {
      throw new Error('INVALID_CREDENTIALS');
    }

    if (admin.status !== 'ACTIVE') {
      throw new Error('ACCOUNT_DISABLED');
    }

    const isMatch = await bcrypt.compare(passwordPlain, admin.password_hash);
    if (!isMatch) {
      throw new Error('INVALID_CREDENTIALS');
    }

    const payload: AuthTokenPayload = {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role
    };

    const expiresIn = rememberMe ? env.jwtRememberExpiresIn : env.jwtExpiresIn;
    const token = jwt.sign(payload, env.jwtSecret, { expiresIn: expiresIn as any });

    await adminRepository.updateLastLogin(admin.id);

    await auditRepository.record({
      adminId: admin.id,
      adminName: admin.name,
      adminEmail: admin.email,
      action: 'ADMIN_LOGIN',
      targetType: 'ADMIN',
      targetId: admin.id,
      reason: 'Admin portal login verified successfully',
      ipAddress,
      userAgent
    });

    return {
      token,
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        status: admin.status,
        avatarUrl: admin.avatar_url,
        avatar_url: admin.avatar_url,
        admin_profile_photo_url: admin.avatar_url,
        lastLoginAt: admin.last_login_at,
        createdAt: admin.created_at
      }
    };
  }

  async logout(admin: AuthTokenPayload, ipAddress?: string, userAgent?: string): Promise<void> {
    await auditRepository.record({
      adminId: admin.id,
      adminName: admin.name,
      adminEmail: admin.email,
      action: 'ADMIN_LOGOUT',
      targetType: 'ADMIN',
      targetId: admin.id,
      reason: 'User signed out',
      ipAddress,
      userAgent
    });
  }

  async getProfile(adminId: string): Promise<AdminProfileDTO | null> {
    const admin = await adminRepository.findById(adminId);
    if (!admin) return null;
    return {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      status: admin.status,
      avatarUrl: admin.avatar_url,
      avatar_url: admin.avatar_url,
      admin_profile_photo_url: admin.avatar_url,
      lastLoginAt: admin.last_login_at,
      createdAt: admin.created_at
    };
  }
}

export const authService = new AuthService();
