import type { Api, Context } from 'grammy';
import { callDo } from '../db/do-client';
import type { Env, Game, Player } from '../types';
import { announceGamesKeyboard, gameRsvpKeyboard } from './keyboards';
import { parseAdminIds } from '../api/auth';

interface AnnounceSession {
  scheduledDate?: number;
  ticketPrice?: number;
  maxPlayers?: number;
}

export function parseGameDateInput(text: string): number | null {
  const t = text.trim();
  const m = t.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1;
  const year = parseInt(m[3], 10);
  const hour = m[4] ? parseInt(m[4], 10) : 19;
  const minute = m[5] ? parseInt(m[5], 10) : 0;
  const d = new Date(year, month, day, hour, minute);
  if (Number.isNaN(d.getTime())) return null;
  return d.getTime();
}

export function formatGameDate(ts: number): string {
  return new Date(ts).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTicket(price: number): string {
  return `${price.toLocaleString('ru-RU')} ₽`;
}

export function buildAnnounceText(
  game: Game,
  yesCount: number,
  roster: Array<{ queue_order: number; name: string }> = [],
): string {
  const spotsLeft = Math.max(0, game.max_players - yesCount);
  const rosterBlock =
    roster.length > 0
      ? `\n📋 *Очередь (место → игрок):*\n${roster.map((r) => `${r.queue_order}. ${r.name}`).join('\n')}\n`
      : '\n📋 *Очередь:* пока никого\n';
  return (
    `🃏 *Покерный вечер*\n\n` +
    `📅 ${formatGameDate(game.date)}\n` +
    `💵 Билет: ${formatTicket(game.ticket_price)}\n` +
    `👥 Мест: ${game.max_players} · занято *${yesCount}* · свободно *${spotsLeft}*` +
    rosterBlock +
    `\nНажмите «Участвую», если идёте.\n` +
    `_Сначала /register — без регистрации в рейтинг не запишет._\n` +
    `_Первые ${game.max_players} по порядку нажатия попадают в состав._`
  );
}

async function loadAnnounceMessage(env: Env, gameId: number, game: Game): Promise<string> {
  const roster = await callDo<{
    ok: boolean;
    entries: Array<{ queue_order: number; name: string; player_id: number }>;
  }>(env, {
    action: 'listRsvpYesWithQueue',
    gameId,
  });
  const entries = roster.entries ?? [];
  return buildAnnounceText(game, entries.length, entries);
}

async function syncAllInviteMessages(api: Api, env: Env, gameId: number, game: Game): Promise<void> {
  const text = await loadAnnounceMessage(env, gameId, game);
  const stored = await callDo<{ ok: boolean; messages: Array<{ telegram_id: number; message_id: number }> }>(
    env,
    { action: 'listInviteMessages', gameId },
  );
  const markup = gameRsvpKeyboard(gameId);
  for (const row of stored.messages) {
    try {
      await api.editMessageText(row.telegram_id, row.message_id, text, {
        parse_mode: 'Markdown',
        reply_markup: markup,
      });
    } catch (e) {
      console.error('invite sync failed', row.telegram_id, e);
    }
  }
}

async function notifyAllRegistered(
  api: Api,
  env: Env,
  text: string,
  exceptTelegramId?: number,
): Promise<void> {
  const players = await callDo<{ ok: boolean; players: Player[] }>(env, {
    action: 'listRegisteredPlayers',
  });
  for (const p of players.players) {
    if (!p.telegram_id || p.telegram_id === exceptTelegramId) continue;
    try {
      await api.sendMessage(p.telegram_id, text);
    } catch (e) {
      console.error('notify failed', p.telegram_id, e);
    }
  }
}

export async function startAnnounceWizard(ctx: Context, env: Env): Promise<void> {
  await callDo(env, {
    action: 'setSession',
    userId: ctx.from!.id,
    state: 'announce_date',
    data: {},
  });
  await ctx.reply(
    '📢 *Новая игра*\n\nШаг 1/3: дата и время игры.\nПример: `28.09.2026 19:00`',
    { parse_mode: 'Markdown' },
  );
}

export async function handleAnnounceInput(ctx: Context, env: Env, text: string): Promise<boolean> {
  const userId = ctx.from!.id;
  const sessionRes = await callDo<{ ok: boolean; session: { state: string; data: AnnounceSession } | null }>(
    env,
    { action: 'getSession', userId },
  );
  const session = sessionRes.session;
  if (!session) return false;

  if (session.state === 'announce_date') {
    const ts = parseGameDateInput(text);
    if (!ts) {
      await ctx.reply('Не понял дату. Пример: 28.09.2026 19:00');
      return true;
    }
    await callDo(env, {
      action: 'setSession',
      userId,
      state: 'announce_ticket',
      data: { scheduledDate: ts },
    });
    await ctx.reply('Шаг 2/3: стоимость входного билета (число). Пример: `1000`');
    return true;
  }

  if (session.state === 'announce_ticket') {
    const ticketPrice = parseInt(text.replace(/\s/g, ''), 10);
    if (Number.isNaN(ticketPrice) || ticketPrice < 0) {
      await ctx.reply('Введите число, например 1000');
      return true;
    }
    await callDo(env, {
      action: 'setSession',
      userId,
      state: 'announce_max',
      data: { ...session.data, ticketPrice },
    });
    await ctx.reply('Шаг 3/3: максимум игроков. Пример: `8`');
    return true;
  }

  if (session.state === 'announce_max') {
    const maxPlayers = parseInt(text.replace(/\s/g, ''), 10);
    if (Number.isNaN(maxPlayers) || maxPlayers < 1) {
      await ctx.reply('Введите число от 1, например 8');
      return true;
    }
    const { scheduledDate, ticketPrice } = session.data;
    if (!scheduledDate || ticketPrice === undefined) {
      await ctx.reply('Сессия сбилась. Начните снова: /announce');
      await callDo(env, { action: 'clearSession', userId });
      return true;
    }

    await callDo(env, { action: 'clearSession', userId });

    const created = await callDo<{ ok: boolean; gameId: number; game: Game }>(env, {
      action: 'createAnnouncedGame',
      scheduledDate,
      ticketPrice,
      maxPlayers,
      createdBy: userId,
    });

    const players = await callDo<{ ok: boolean; players: Player[] }>(env, {
      action: 'listRegisteredPlayers',
    });

    let sent = 0;
    const inviteText = buildAnnounceText(created.game, 0);
    for (const p of players.players) {
      if (!p.telegram_id) continue;
      try {
        const msg = await ctx.api.sendMessage(p.telegram_id, inviteText, {
          parse_mode: 'Markdown',
          reply_markup: gameRsvpKeyboard(created.gameId),
        });
        await callDo(env, {
          action: 'saveInviteMessage',
          gameId: created.gameId,
          telegramId: p.telegram_id,
          messageId: msg.message_id,
        });
        sent++;
      } catch (e) {
        console.error('announce send failed', p.telegram_id, e);
      }
    }

    await ctx.reply(
      `✅ Игра #${created.gameId} создана.\nРазослано ${sent} из ${players.players.length} зарегистрированных.\n\nСтарт игры: /admin → Игры → Старт игры`,
    );
    return true;
  }

  return false;
}

export async function handleGameRsvp(
  ctx: Context,
  env: Env,
  gameId: number,
  response: 'yes' | 'no',
): Promise<void> {
  const telegramId = ctx.from!.id;
  const playerRes = await callDo<{ ok: boolean; player: Player | null }>(env, {
    action: 'getPlayerByTelegramId',
    telegramId,
  });
  if (!playerRes.player) {
    await ctx.answerCallbackQuery({
      text: 'Сначала нажмите /start и пройдите регистрацию (/register)',
      show_alert: true,
    });
    return;
  }

  let result: {
    ok: boolean;
    error?: string;
    registrationClosed?: boolean;
    yesCount?: number;
    queueOrder?: number | null;
  };
  try {
    result = await callDo(env, {
      action: 'setGameRsvp',
      gameId,
      playerId: playerRes.player.id,
      response,
    });
  } catch (e) {
    await ctx.answerCallbackQuery({ text: String(e), show_alert: true });
    return;
  }

  if (!result.ok) {
    await ctx.answerCallbackQuery({ text: result.error || 'Ошибка', show_alert: true });
    return;
  }

  const gameRes = await callDo<{ ok: boolean; game: Game }>(env, {
    action: 'getGameById',
    gameId,
  });
  const game = gameRes.game;

  if (response === 'yes') {
    const spot = result.queueOrder ?? result.yesCount ?? 0;
    await ctx.answerCallbackQuery({
      text: spot > 0 ? `Вы в очереди: место ${spot} из ${game.max_players}` : 'Записано',
    });
    const short = `✅ ${playerRes.player.name} — место ${spot} в очереди на игру #${gameId} (всего мест ${game.max_players}).`;
    await notifyAllRegistered(ctx.api, env, short);
  } else {
    await ctx.answerCallbackQuery({ text: 'Понятно, без вас' });
  }

  await syncAllInviteMessages(ctx.api, env, gameId, game);

  if (result.registrationClosed) {
    const admins = parseAdminIds(env.ADMIN_IDS);
    for (const adminId of admins) {
      try {
        await ctx.api.sendMessage(
          adminId,
          `🔔 Игра #${gameId}: все ${result.yesCount} мест заняты. Можно нажать «Старт» в админ-меню.`,
        );
      } catch {
        /* ignore */
      }
    }
  }
}

export async function listAnnouncedForStart(ctx: Context, env: Env): Promise<void> {
  const res = await callDo<{ ok: boolean; games: Game[] }>(env, { action: 'listAnnouncedGames' });
  if (res.games.length === 0) {
    await ctx.reply('Нет игр в ожидании старта.');
    return;
  }
  const withCounts: Array<{ id: number; date: number; yesCount: number; maxPlayers: number }> = [];
  for (const g of res.games) {
    const sum = await callDo<{ ok: boolean; yesCount: number; maxPlayers: number }>(env, {
      action: 'getRsvpSummary',
      gameId: g.id,
    });
    withCounts.push({
      id: g.id,
      date: g.date,
      yesCount: sum.yesCount ?? 0,
      maxPlayers: sum.maxPlayers ?? g.max_players,
    });
  }
  await ctx.reply('▶️ Выберите игру для старта (в кнопке — сколько записалось):', {
    reply_markup: announceGamesKeyboard(withCounts),
  });
}

export async function startGameAction(ctx: Context, env: Env, gameId: number): Promise<void> {
  const result = await callDo<{ ok: boolean; error?: string; roster?: Player[] }>(env, {
    action: 'startAnnouncedGame',
    gameId,
  });
  if (!result.ok) {
    await ctx.reply(`❌ ${result.error ?? 'Не удалось стартовать игру'}`);
    return;
  }
  let roster = Array.isArray(result.roster) ? result.roster : [];
  if (roster.length === 0) {
    const again = await callDo<{ ok: boolean; players: Player[] }>(env, {
      action: 'listRsvpYesPlayers',
      gameId,
    });
    roster = again.players ?? [];
  }
  if (roster.length === 0) {
    await ctx.reply(
      `❌ Игра #${gameId}: в ответе сервера пустой состав, хотя старт прошёл. Проверьте RSVP и сделайте новый анонс.`,
    );
    return;
  }
  const lines = roster.map((p, i) => `${i + 1}. ${p.name}`).join('\n');
  await ctx.reply(
    `▶️ Игра #${gameId} открыта!\n\nСостав (${roster.length}):\n${lines}\n\n(Ввод результатов — следующий этап.)`,
  );

  const players = await callDo<{ ok: boolean; players: Player[] }>(env, {
    action: 'listRegisteredPlayers',
  });
  for (const p of players.players) {
    if (!p.telegram_id) continue;
    try {
      await ctx.api.sendMessage(
        p.telegram_id,
        `▶️ Игра #${gameId} началась. Удачи за столом! 🃏`,
      );
    } catch {
      /* ignore */
    }
  }
}
