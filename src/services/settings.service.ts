import { settingsRepository } from '../repositories/settings.repository';
import { auditRepository } from '../repositories/audit.repository';
import { AuthTokenPayload } from '../models/admin.model';

export class SettingsService {
  async getSettings() {
    return settingsRepository.getAll();
  }

  async updateSetting(
    key: string,
    value: any,
    admin: AuthTokenPayload,
    ipAddress?: string,
    userAgent?: string
  ) {
    const updated = await settingsRepository.update(key, value, admin.id);

    await auditRepository.record({
      adminId: admin.id,
      adminName: admin.name,
      adminEmail: admin.email,
      action: 'CHANGED_SETTINGS',
      targetType: 'SETTINGS',
      targetId: key,
      reason: `Updated configuration parameters for ${key}`,
      details: value,
      ipAddress,
      userAgent
    });

    return updated;
  }
}

export const settingsService = new SettingsService();
