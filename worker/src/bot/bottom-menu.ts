import type { Context } from 'grammy';
import { InlineKeyboard, Keyboard } from 'grammy';
import { isAdmin, parseAdminIds } from '../api/auth';
import { callDo } from '../db/do-client';
import type { Env } from '../types';

/** Текст кнопки регистрации на нижней клавиатуре */
export const REGISTER_BUTTON_TEXT = '✍️ Регистрация';
export const STATS_BUTTON_TEXT = '📊 Статистика';
export const ADMIN_BUTTON_TEXT = '🔧 Админ';

export function webappUrls(webappUrl: string): { stats: string; admin: string } {
  const base = webappUrl.endsWith('/') ? webappUrl : `${webappUrl}/`;
  return { stats: base, admin: `${base}?view=admin` };
}

export function statsInlineKeyboard(webappUrl: string): InlineKeyboard {
  const { stats } = webappUrls(webappUrl);
  return new InlineKeyboard().webApp('📊 Открыть статистику', stats);
}

export function adminInlineKeyboard(webappUrl: string): InlineKeyboard {
  const { admin } = webappUrls(webappUrl);
  return new InlineKeyboard().webApp('🔧 Открыть админ-панель', admin);
}

/**
 * Нижняя клавиатура — обычный текст (не web_app: у reply-кнопок часто нет initData).
 * Mini App открывается через Menu Button или inline-кнопку в сообщении.
 */
export function buildBottomKeyboard(registered: boolean, userIsAdmin: boolean): Keyboard {
  if (!registered) {
    return new Keyboard().text(REGISTER_BUTTON_TEXT).resized().persistent();
  }
  if (userIsAdmin) {
    return new Keyboard()
      .text(ADMIN_BUTTON_TEXT)
      .text(STATS_BUTTON_TEXT)
      .resized()
      .persistent();
  }
  return new Keyboard().text(STATS_BUTTON_TEXT).resized().persistent();
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
    keyboard: buildBottomKeyboard(registered, userIsAdmin),
    registered,
    isAdmin: userIsAdmin,
  };
}

/** Menu Button (слева от поля ввода) + reply-клавиатура */
export async function syncUserBottomMenu(ctx: Context, env: Env, telegramId: number): Promise<Keyboard> {
  const { keyboard, registered } = await buildBottomKeyboardForUser(env, telegramId);
  const chatId = ctx.chat?.id;
  if (chatId) {
    try {
      if (registered) {
        const { stats } = webappUrls(env.WEBAPP_URL);
        await ctx.api.setChatMenuButton({
          chat_id: chatId,
          menu_button: {
            type: 'web_app',
            text: '📊 Статистика',
            web_app: { url: stats },
          },
        });
      } else {
        await ctx.api.setChatMenuButton({ chat_id: chatId, menu_button: { type: 'default' } });
      }
    } catch (e) {
      console.error('setChatMenuButton failed', e);
    }
  }
  return keyboard;
}
