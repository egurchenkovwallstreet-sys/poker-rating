import { validate } from '@telegram-apps/init-data-node';

export function validateInitData(initData: string, botToken: string): { userId: number } | null {
  try {
    validate(initData, botToken, { expiresIn: 86400 });
    const params = new URLSearchParams(initData);
    const userStr = params.get('user');
    if (!userStr) return null;
    const user = JSON.parse(userStr) as { id: number };
    return { userId: user.id };
  } catch {
    return null;
  }
}

export function parseAdminIds(raw: string): number[] {
  try {
    const ids = JSON.parse(raw) as number[];
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

export function isAdmin(userId: number, adminIds: number[]): boolean {
  return adminIds.includes(userId);
}
