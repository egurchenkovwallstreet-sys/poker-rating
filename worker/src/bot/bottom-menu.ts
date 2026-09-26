import type { Api, Context } from 'grammy';
import { InlineKeyboard, Keyboard } from 'grammy';
import { isAdmin, parseAdminIds } from '../api/auth';
import { callDo } from '../db/do-client';
import type { Env } from '../types';

export const REGISTER_BUTTON_TEXT = '✍️ Регистрация';
export const STATS_BUTTON_TEXT = '📊 Статистика';
export const ADMIN_BUTTON_TEXT = '🔧 Админ';

export function webappUrls(webappUrl: string): { stats: string } {
  const base = webappUrl.endsWith('/') ? webappUrl : `${webappUrl}/`;
  return { stats: base };
}

export function statsInlineKeyboard(webappUrl: string): InlineKeyboard {
  const { stats } = webappUrls(webappUrl);
  return new InlineKeyboard().webApp('📊 Открыть статистику', stats);
}

/** Нижняя клавиатура (только текст; Mini App — через inline после «Статистика»). */
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

/** Убирает Web App «Статистика» с боковой Menu Button (глобально + для чата). */
export async function resetSideMenuButtonToDefault(api: Api, chatId?: number): Promise<void> {
  const menu_button = { type: 'default' as const };
  try {
    await api.setChatMenuButton({ menu_button });
  } catch (e) {
    console.error('setChatMenuButton default (bot-wide) failed', e);
  }
  if (chatId != null) {
    try {
      await api.setChatMenuButton({ chat_id: chatId, menu_button });
    } catch (e) {
      console.error('setChatMenuButton default (chat) failed', e);
    }
  }
}

/** Reply-клавиатура внизу; боковую Menu Button (Web App) не используем. */
export async function syncUserBottomMenu(ctx: Context, env: Env, telegramId: number): Promise<Keyboard> {
  const { keyboard } = await buildBottomKeyboardForUser(env, telegramId);
  await resetSideMenuButtonToDefault(ctx.api, ctx.chat?.id);
  return keyboard;
}
