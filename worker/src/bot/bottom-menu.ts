import type { Context } from 'grammy';
import { Keyboard } from 'grammy';
import { isAdmin, parseAdminIds } from '../api/auth';
import { callDo } from '../db/do-client';
import type { Env } from '../types';

/** Текст кнопки регистрации на нижней клавиатуре */
export const REGISTER_BUTTON_TEXT = '✍️ Регистрация';

function webappUrls(webappUrl: string): { stats: string; admin: string } {
  const base = webappUrl.endsWith('/') ? webappUrl : `${webappUrl}/`;
  return { stats: base, admin: `${base}?view=admin` };
}

export function buildBottomKeyboard(webappUrl: string, registered: boolean, admin: boolean): Keyboard {
  const { stats, admin: adminUrl } = webappUrls(webappUrl);
  if (!registered) {
    return new Keyboard().text(REGISTER_BUTTON_TEXT).resized().persistent();
  }
  if (admin) {
    return new Keyboard()
      .webApp('🔧 Админ', adminUrl)
      .webApp('📊 Статистика', stats)
      .resized()
      .persistent();
  }
  return new Keyboard().webApp('📊 Статистика', stats).resized().persistent();
}

export async function buildBottomKeyboardForUser(
  env: Env,
  telegramId: number,
): Promise<{ keyboard: Keyboard; registered: boolean; isAdmin: boolean }> {
  const playerRes = await callDo<{ ok: boolean; player: unknown | null }>(env, {
    action: 'getPlayerByTelegramId',
    telegramId,
  });
  const registered = Boolean(playerRes.player);
  const userIsAdmin = isAdmin(telegramId, parseAdminIds(env.ADMIN_IDS));
  return {
    keyboard: buildBottomKeyboard(env.WEBAPP_URL, registered, userIsAdmin),
    registered,
    isAdmin: userIsAdmin,
  };
}

/** Нижняя клавиатура + сброс menu button (чтобы не дублировать с reply-клавиатурой) */
export async function syncUserBottomMenu(ctx: Context, env: Env, telegramId: number): Promise<Keyboard> {
  const chatId = ctx.chat?.id;
  if (chatId) {
    try {
      await ctx.api.setChatMenuButton({ chat_id: chatId, menu_button: { type: 'default' } });
    } catch (e) {
      console.error('setChatMenuButton failed', e);
    }
  }
  const { keyboard } = await buildBottomKeyboardForUser(env, telegramId);
  return keyboard;
}
