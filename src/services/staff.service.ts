import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { adminRepository } from '../repositories/admin.repository';
import { auditRepository } from '../repositories/audit.repository';
import { AdminRole, AdminStatus, AuthTokenPayload } from '../models/admin.model';

export class StaffService {
  async listStaff() {
    return adminRepository.findAll();
  }

  async createStaff(
    data: { name: string; email: string; passwordPlain: string; role: AdminRole },
    currentAdmin: AuthTokenPayload,
    ipAddress?: string,
    userAgent?: string
  ) {
    const existing = await adminRepository.findByEmail(data.email);
    if (existing) {
      throw new Error('EMAIL_EXISTS');
    }

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(data.passwordPlain, salt);
    const newId = uuidv4();

    const created = await adminRepository.create({
      id: newId,
      name: data.name,
      email: data.email,
      password_hash: passwordHash,
      role: data.role
    });

    await auditRepository.record({
      adminId: currentAdmin.id,
      adminName: currentAdmin.name,
      adminEmail: currentAdmin.email,
      action: 'CREATED_ADMIN',
      targetType: 'ADMIN',
      targetId: newId,
      reason: `Created staff member with role ${data.role}`,
      details: { email: data.email, role: data.role },
      ipAddress,
      userAgent
    });

    return {
      id: created.id,
      name: created.name,
      email: created.email,
      role: created.role,
      status: created.status
    };
  }

  async updateStaff(
    id: string,
    updates: { name?: string; role?: AdminRole; status?: AdminStatus },
    currentAdmin: AuthTokenPayload,
    ipAddress?: string,
    userAgent?: string
  ) {
    if (id === currentAdmin.id && updates.status === 'DISABLED') {
      throw new Error('CANNOT_DISABLE_SELF');
    }

    const updated = await adminRepository.update(id, updates);
    if (!updated) throw new Error('ADMIN_NOT_FOUND');

    await auditRepository.record({
      adminId: currentAdmin.id,
      adminName: currentAdmin.name,
      adminEmail: currentAdmin.email,
      action: 'UPDATED_ADMIN',
      targetType: 'ADMIN',
      targetId: id,
      reason: `Updated staff parameters: ${JSON.stringify(updates)}`,
      details: updates,
      ipAddress,
      userAgent
    });

    return {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      role: updated.role,
      status: updated.status
    };
  }

  async deleteStaff(
    id: string,
    currentAdmin: AuthTokenPayload,
    ipAddress?: string,
    userAgent?: string
  ) {
    if (id === currentAdmin.id) {
      throw new Error('CANNOT_DELETE_SELF');
    }

    const deleted = await adminRepository.delete(id);
    if (!deleted) throw new Error('ADMIN_NOT_FOUND');

    await auditRepository.record({
      adminId: currentAdmin.id,
      adminName: currentAdmin.name,
      adminEmail: currentAdmin.email,
      action: 'DELETED_ADMIN',
      targetType: 'ADMIN',
      targetId: id,
      reason: `Removed staff member ${deleted.email}`,
      ipAddress,
      userAgent
    });
  }
}

export const staffService = new StaffService();
