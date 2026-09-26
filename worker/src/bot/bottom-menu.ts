import type { Context } from 'grammy';
import { InlineKeyboard, Keyboard } from 'grammy';
import { callDo } from '../db/do-client';
import type { Env } from '../types';

export const REGISTER_BUTTON_TEXT = '✍️ Регистрация';
export const STATS_BUTTON_TEXT = '📊 Статистика';

export function webappUrls(webappUrl: string): { stats: string } {
  const base = webappUrl.endsWith('/') ? webappUrl : `${webappUrl}/`;
  return { stats: base };
}

export function statsInlineKeyboard(webappUrl: string): InlineKeyboard {
  const { stats } = webappUrls(webappUrl);
  return new InlineKeyboard().webApp('📊 Открыть статистику', stats);
}

/** Нижняя клавиатура: текст → inline Web App (надёжный initData). */
export function buildBottomKeyboard(registered: boolean): Keyboard {
  if (!registered) {
    return new Keyboard().text(REGISTER_BUTTON_TEXT).resized().persistent();
  }
  return new Keyboard().text(STATS_BUTTON_TEXT).resized().persistent();
}

export async function buildBottomKeyboardForUser(
  env: Env,
  telegramId: number,
): Promise<{ keyboard: Keyboard; registered: boolean }> {
  const playerRes = await callDo<{ ok: boolean; player: unknown | null }>(env, {
    action: 'getPlayerByTelegramId',
    telegramId,
  });
  const registered = Boolean(playerRes.player);
  return {
    keyboard: buildBottomKeyboard(registered),
    registered,
  };
}

/** Menu Button (слева от ввода) + reply-клавиатура */
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
