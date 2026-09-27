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
    `🃏 *Покерный вечер*\n` +
    `🆔 *Игра #${game.id}* — кнопки только в этом сообщении\n\n` +
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

async function loadActiveAnnouncePayload(
  env: Env,
): Promise<{ text: string; gameId: number; game: Game } | null> {
  const active = await callDo<{ ok: boolean; gameId: number | null; game: Game | null }>(env, {
    action: 'getActiveAnnouncedGame',
  });
  if (!active.game || active.gameId == null) return null;
  const text = await loadAnnounceMessage(env, active.gameId, active.game);
  return { text, gameId: active.gameId, game: active.game };
}

/** Обновить все сохранённые анонсы в личках: один текст, кнопки с актуальным 🆔 #. */
async function syncAllInviteMessages(api: Api, env: Env): Promise<void> {
  const loaded = await loadActiveAnnouncePayload(env);
  if (!loaded) return;
  const { text, gameId } = loaded;
  const stored = await callDo<{
    ok: boolean;
    messages: Array<{ game_id: number; telegram_id: number; message_id: number }>;
  }>(env, { action: 'listAllInviteMessages' });
  const markup = gameRsvpKeyboard(gameId);
  for (const row of stored.messages ?? []) {
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

/** Обновить сообщение, где нажали кнопку (участники часто не в invite_messages). */
async function refreshClickerInviteMessage(
  ctx: Context,
  env: Env,
  gameId: number,
  game: Game,
  telegramId: number,
): Promise<void> {
  const text = await loadAnnounceMessage(env, gameId, game);
  const markup = gameRsvpKeyboard(gameId);
  const msg = ctx.callbackQuery?.message;
  if (msg && msg.chat.id === telegramId && 'message_id' in msg) {
    try {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: markup });
      await callDo(env, {
        action: 'saveInviteMessage',
        gameId,
        telegramId,
        messageId: msg.message_id,
      });
      return;
    } catch (e) {
      console.error('edit clicker invite failed', telegramId, e);
    }
  }
  try {
    const sent = await ctx.api.sendMessage(telegramId, text, {
      parse_mode: 'Markdown',
      reply_markup: markup,
    });
    await callDo(env, {
      action: 'saveInviteMessage',
      gameId,
      telegramId,
      messageId: sent.message_id,
    });
  } catch (e) {
    console.error('send clicker invite failed', telegramId, e);
  }
}

/** После /register — прислать анонсы открытых игр (иначе жмут старые кнопки). */
export async function sendOpenAnnouncedInvitesToPlayer(
  api: Api,
  env: Env,
  telegramId: number,
): Promise<number> {
  const active = await callDo<{ ok: boolean; gameId: number | null; game: Game | null }>(env, {
    action: 'getActiveAnnouncedGame',
  });
  if (!active.game || active.gameId == null) return 0;
  const game = active.game;
  const text = await loadAnnounceMessage(env, active.gameId, game);
  try {
    const msg = await api.sendMessage(telegramId, text, {
      parse_mode: 'Markdown',
      reply_markup: gameRsvpKeyboard(active.gameId),
    });
    await callDo(env, {
      action: 'saveInviteMessage',
      gameId: active.gameId,
      telegramId,
      messageId: msg.message_id,
    });
    return 1;
  } catch (e) {
    console.error('open invite send failed', telegramId, active.gameId, e);
    return 0;
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
    if (Number.isNaN(maxPlayers) || maxPlayers < 2) {
      await ctx.reply('Минимум 2 места. Введите число от 2, например 8');
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

    const activeGameId = created.game?.id ?? created.gameId;

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
          reply_markup: gameRsvpKeyboard(activeGameId),
        });
        await callDo(env, {
          action: 'saveInviteMessage',
          gameId: activeGameId,
          telegramId: p.telegram_id,
          messageId: msg.message_id,
        });
        sent++;
      } catch (e) {
        console.error('announce send failed', p.telegram_id, e);
      }
    }

    await syncAllInviteMessages(ctx.api, env);

    await ctx.reply(
      `✅ Игра #${activeGameId} создана (старые анонсы закрыты).\nРазослано ${sent} из ${players.players.length} зарегистрированных.\n\n` +
        `⚠️ «Участvую» только в *этом* сообщении с 🆔 #${activeGameId}.\n\n` +
        `Старт: 🔧 Админ → Игры → Старт игры → кнопка с «N/… запис.»`,
      { parse_mode: 'Markdown' },
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
    effectiveGameId?: number;
    clickedGameId?: number;
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

  const activeGameId = result.effectiveGameId ?? gameId;

  const gameRes = await callDo<{ ok: boolean; game: Game }>(env, {
    action: 'getGameById',
    gameId: activeGameId,
  });
  const game = gameRes.game;
  if (!game) {
    await ctx.answerCallbackQuery({ text: 'Игра не найдена', show_alert: true });
    return;
  }

  const queueRes = await callDo<{
    ok: boolean;
    entries: Array<{ queue_order: number; name: string; player_id: number }>;
  }>(env, { action: 'listRsvpYesWithQueue', gameId: activeGameId });

  if (response === 'yes') {
    const pid = Number(playerRes.player!.id);
    const me = queueRes.entries?.find((e) => Number(e.player_id) === pid);
    if (!me) {
      await ctx.answerCallbackQuery({
        text: `Вы не в очереди игры #${activeGameId}. Нужен свежий анонс с 🆔 #${activeGameId}.`,
        show_alert: true,
      });
      await ctx.reply(
        `⚠️ Запись *не сохранилась* (игра #${gameId}).\n\n` +
          `Часто так бывает, если кнопка из *старого* сообщения или вы зарегистрировались *после* анонса.\n\n` +
          `Сделайте /register и дождитесь *нового* сообщения с «🆔 Игра #…», затем «Участvую».`,
        { parse_mode: 'Markdown' },
      );
      return;
    }
    const spot = me.queue_order;
    const totalYes = queueRes.entries.length;
    const cap = game.max_players > 0 ? game.max_players : Math.max(totalYes, 8);
    const queueLine = queueRes.entries.map((e) => `${e.queue_order}. ${e.name}`).join(', ');
    const idNote =
      result.clickedGameId != null && result.clickedGameId !== activeGameId
        ? ` (кнопка #${result.clickedGameId} → запись на #${activeGameId})`
        : '';
    await ctx.answerCallbackQuery({
      text: `Игра #${activeGameId}: место ${spot} из ${cap} (записано: ${totalYes})${idNote}`,
      show_alert: true,
    });
    const short =
      `✅ ${playerRes.player.name} — место ${spot} на игре #${activeGameId} (всего: ${totalYes}).\n` +
      `Очередь: ${queueLine}`;
    await notifyAllRegistered(ctx.api, env, short);
    await refreshClickerInviteMessage(ctx, env, activeGameId, game, telegramId);
  } else {
    await ctx.answerCallbackQuery({ text: 'Понятно, без вас' });
    await refreshClickerInviteMessage(ctx, env, activeGameId, game, telegramId);
  }

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
  const res = await callDo<{
    ok: boolean;
    games: Array<{ id: number; date: number; max_players: number; yesCount: number }>;
  }>(env, { action: 'listAnnouncedGamesForStart' });
  const withCounts = res.games ?? [];
  if (withCounts.length === 0) {
    await ctx.reply('Нет игр в ожидании старта.');
    return;
  }
  withCounts.sort((a, b) => b.yesCount - a.yesCount || a.date - b.date);
  const withRsvp = withCounts
    .filter((g) => g.yesCount > 0)
    .map((g) => ({
      id: g.id,
      date: g.date,
      yesCount: g.yesCount,
      maxPlayers: g.max_players,
    }));
  if (withRsvp.length === 0) {
    const ids = withCounts.map((g) => `#${g.id}`).join(', ');
    await ctx.reply(
      `❌ Ни на одной анонсированной игре нет «Участvую» (${ids}).\n\n` +
        `1) Сделайте новый анонс.\n` +
        `2) Все жмут «Участvую» в сообщении с 🆔 Игра #… (не в старых).\n` +
        `3) Старт — кнопка с «N/… запис.» где N > 0.\n\n` +
        `Диагностика: /rsvpdebug номер_игры`,
    );
    return;
  }
  const empty = withCounts.filter((g) => g.yesCount === 0);
  let hint = '▶️ Стартуйте игру с записями (кнопка «N/… запис.», N > 0):';
  if (empty.length > 0) {
    hint += `\nБез записей: ${empty.map((g) => `#${g.id}`).join(', ')} — не эти.`;
  }
  await ctx.reply(hint, { reply_markup: announceGamesKeyboard(withRsvp) });
}

export async function startGameAction(ctx: Context, env: Env, gameId: number): Promise<void> {
  let result: {
    ok: boolean;
    error?: string;
    roster?: Player[];
    players?: Player[];
    yesCount?: number;
    startedGameId?: number;
    requestedGameId?: number;
    mergedFromOtherGames?: boolean;
  };
  try {
    result = await callDo(env, {
      action: 'startAnnouncedGame',
      gameId,
    });
  } catch (e) {
    await ctx.reply(`❌ ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  if (!result.ok) {
    await ctx.reply(`❌ ${result.error ?? 'Не удалось стартовать игру'}`);
    return;
  }
  const loadGameId = result.startedGameId ?? gameId;
  let roster = result.players ?? result.roster ?? [];
  if (roster.length === 0) {
    const again = await callDo<{ ok: boolean; players: Player[] }>(env, {
      action: 'listRsvpYesPlayers',
      gameId: loadGameId,
    });
    roster = again.players ?? [];
  }
  if (roster.length === 0) {
    const sum = await callDo<{ ok: boolean; yesCount: number }>(env, {
      action: 'getRsvpSummary',
      gameId: loadGameId,
    });
    await ctx.reply(
      `❌ Игра #${gameId}: состав пустой (RSVP yes в базе: ${sum.yesCount ?? 0}).\n` +
        `Старт отменён. /rsvpdebug ${gameId}`,
    );
    return;
  }
  const startedId = result.startedGameId ?? gameId;
  const lines = roster.map((p, i) => `${i + 1}. ${p.name ?? `id:${p.id}`}`).join('\n');
  let head = `▶️ Игра #${startedId} открыта!`;
  if (result.requestedGameId != null && result.startedGameId != null && result.requestedGameId !== result.startedGameId) {
    head += `\n_(Кнопка была для #${result.requestedGameId}; записи на #${result.startedGameId}.)_`;
  }
  if (result.mergedFromOtherGames) {
    head += `\n_(Записи с других анонсов перенесены на #${startedId}.)_`;
  }
  await ctx.reply(
    `${head}\n\nСостав (${roster.length}):\n${lines}\n\n(Ввод результатов — следующий этап.)`,
    { parse_mode: 'Markdown' },
  );

  const players = await callDo<{ ok: boolean; players: Player[] }>(env, {
    action: 'listRegisteredPlayers',
  });
  for (const p of players.players) {
    if (!p.telegram_id) continue;
    try {
      await ctx.api.sendMessage(
        p.telegram_id,
        `▶️ Игра #${startedId} началась. Удачи за столом! 🃏`,
      );
    } catch {
      /* ignore */
    }
  }
}
