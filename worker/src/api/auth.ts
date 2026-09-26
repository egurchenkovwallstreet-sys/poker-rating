import { createHmac, timingSafeEqual } from 'node:crypto';
import { validate } from '@telegram-apps/init-data-node';

const INIT_DATA_TTL_SEC = 86400 * 7;

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/** Проверка подписи initData по документации Telegram (HMAC-SHA256). */
function validateInitDataTelegram(initData: string, botToken: string): boolean {
  const token = botToken.trim();
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return false;

  params.delete('hash');
  const authDateStr = params.get('auth_date');
  if (!authDateStr) return false;
  const authDate = parseInt(authDateStr, 10);
  if (Number.isNaN(authDate)) return false;
  if (Date.now() / 1000 - authDate > INIT_DATA_TTL_SEC) return false;

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = createHmac('sha256', token).update('WebAppData').digest();
  const calculatedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return safeEqualHex(calculatedHash, hash);
}

export function validateInitData(initData: string, botToken: string): { userId: number } | null {
  const raw = initData?.trim();
  if (!raw) return null;

  const token = botToken.trim();
  let ok = validateInitDataTelegram(raw, token);
  if (!ok) {
    try {
      validate(raw, token, { expiresIn: INIT_DATA_TTL_SEC });
      ok = true;
    } catch {
      ok = false;
    }
  }
  if (!ok) return null;

  const params = new URLSearchParams(raw);
  const userStr = params.get('user');
  if (!userStr) return null;
  try {
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
