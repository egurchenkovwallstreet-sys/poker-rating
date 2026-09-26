import type { Context } from 'grammy';
import { callDo } from '../db/do-client';
import type { Env, GameWithResults, Player } from '../types';
import {
  draftGamesKeyboard,
  gameSummaryKeyboard,
  openGamesKeyboard,
} from './keyboards';

interface SessionData {
  gameId?: number;
  playerIds?: number[];
  currentIndex?: number;
  step?: 'buyin' | 'payout';
  buyins?: Record<number, number>;
  payouts?: Record<number, number>;
  editGameId?: number;
}

export async function handleGameInput(ctx: Context, env: Env, text: string): Promise<boolean> {
  const userId = ctx.from!.id;
  const sessionRes = await callDo<{ ok: boolean; session: { state: string; data: SessionData } | null }>(
    env,
    { action: 'getSession', userId },
  );
  const session = sessionRes.session;
  if (!session || !session.state.startsWith('new_game_')) return false;

  const data = session.data;
  const num = parseInt(text.trim(), 10);
  if (isNaN(num) || num < 0) {
    await ctx.reply('Введите неотрицательное число.');
    return true;
  }

  const playerIds = data.playerIds!;
  const idx = data.currentIndex ?? 0;
  const playersRes = await callDo<{ ok: boolean; players: Player[] }>(env, { action: 'listPlayers' });
  const currentPlayer = playersRes.players.find((p) => p.id === playerIds[idx])!;

  if (data.step === 'buyin') {
    const buyins = { ...data.buyins, [currentPlayer.id]: num };
    const nextIdx = idx + 1;
    if (nextIdx < playerIds.length) {
      const nextPlayer = playersRes.players.find((p) => p.id === playerIds[nextIdx])!;
      await callDo(env, {
        action: 'setSession',
        userId,
        state: 'new_game_buyin',
        data: { ...data, buyins, currentIndex: nextIdx },
      });
      await ctx.reply(`Бай-ин для ${nextPlayer.name}:`);
    } else {
      await callDo(env, {
        action: 'setSession',
        userId,
        state: 'new_game_payout',
        data: { ...data, buyins, currentIndex: 0, step: 'payout' },
      });
      await ctx.reply(`Стек для ${playersRes.players.find((p) => p.id === playerIds[0])!.name}:`);
    }
  } else {
    const payouts = { ...data.payouts, [currentPlayer.id]: num };
    const buyin = data.buyins![currentPlayer.id];
    await callDo(env, {
      action: 'addResult',
      gameId: data.gameId!,
      playerId: currentPlayer.id,
      buyin,
      payout: num,
    });

    const nextIdx = idx + 1;
    if (nextIdx < playerIds.length) {
      const nextPlayer = playersRes.players.find((p) => p.id === playerIds[nextIdx])!;
      await callDo(env, {
        action: 'setSession',
        userId,
        state: 'new_game_payout',
        data: { ...data, payouts, currentIndex: nextIdx },
      });
      await ctx.reply(`Стек для ${nextPlayer.name}:`);
    } else {
      await callDo(env, { action: 'clearSession', userId });
      await showGameSummary(ctx, env, data.gameId!);
    }
  }
  return true;
}

export async function showGameSummary(ctx: Context, env: Env, gameId: number): Promise<void> {
  const gameRes = await callDo<{ ok: boolean; game: GameWithResults['game']; results: GameWithResults['results'] }>(
    env,
    { action: 'getGame', gameId },
  );
  const total = gameRes.results.reduce((s, r) => s + r.profit, 0);
  const lines = gameRes.results.map((r) => {
    const sign = r.profit >= 0 ? '+' : '';
    const emoji = r.profit >= 0 ? '🟢' : '🔴';
    return `${emoji} ${r.player_name}: ${sign}${r.profit} (бай-ин: ${r.buyin}, стек: ${r.payout})`;
  });

  const balanceOk = total === 0 ? '✅' : '❌';
  await ctx.reply(
    `📋 Сводка игры #${gameId}\n\n${lines.join('\n')}\n\n${balanceOk} Сумма: ${total}`,
    { reply_markup: gameSummaryKeyboard(gameId) },
  );
}

export async function finishGameAction(ctx: Context, env: Env, gameId: number): Promise<void> {
  try {
    const result = await callDo<{ ok: boolean; error?: string }>(env, { action: 'finishGame', gameId });
    if (result.ok) {
      await ctx.editMessageText(`✅ Игра #${gameId} завершена и добавлена в статистику.`);
    } else {
      await ctx.answerCallbackQuery({ text: result.error || 'Ошибка', show_alert: true });
    }
  } catch (e) {
    await ctx.answerCallbackQuery({ text: String(e), show_alert: true });
  }
}

export async function deleteGameAction(ctx: Context, env: Env, gameId: number): Promise<void> {
  await callDo(env, { action: 'deleteGame', gameId });
  await ctx.editMessageText(`🗑 Игра #${gameId} удалена.`);
}

export async function listOpenGamesForResults(ctx: Context, env: Env): Promise<void> {
  const res = await callDo<{ ok: boolean; games: Array<{ id: number; date: number }> }>(env, {
    action: 'listOpenGames',
  });
  if (res.games.length === 0) {
    await ctx.reply('Нет игр в статусе «идёт» (open).\n\nСначала: анонс → RSVP → «Старт игры».');
    return;
  }
  await ctx.reply('Выберите игру для ввода результатов:', {
    reply_markup: openGamesKeyboard(res.games, 'game:results'),
  });
}

export async function startOpenGameResultsEntry(
  ctx: Context,
  env: Env,
  gameId: number,
): Promise<void> {
  const userId = ctx.from!.id;
  const prep = await callDo<{
    ok: boolean;
    error?: string;
    playerIds?: number[];
    ticketPrice?: number;
  }>(env, { action: 'prepareOpenGameResults', gameId });

  if (!prep.ok || !prep.playerIds) {
    await ctx.answerCallbackQuery({ text: prep.error || 'Ошибка', show_alert: true });
    return;
  }

  const playerIds = prep.playerIds;
  await callDo(env, {
    action: 'setSession',
    userId,
    state: 'new_game_buyin',
    data: {
      gameId,
      playerIds,
      currentIndex: 0,
      step: 'buyin',
      buyins: {},
      payouts: {},
      fromOpenGame: true,
    },
  });

  const playersRes = await callDo<{ ok: boolean; players: Player[] }>(env, { action: 'listPlayers' });
  const player = playersRes.players.find((p) => p.id === playerIds[0])!;
  const ticketHint =
    prep.ticketPrice && prep.ticketPrice > 0
      ? `\n(Билет по анонсу: ${prep.ticketPrice})`
      : '';

  const text = `Игра #${gameId} — участники из записи на игру.${ticketHint}\n\nБай-ин для ${player.name}:`;
  if (ctx.callbackQuery?.message) {
    await ctx.editMessageText(text);
  } else {
    await ctx.reply(text);
  }
}

export async function listDraftGamesForAction(
  ctx: Context,
  env: Env,
  action: string,
  title: string,
): Promise<void> {
  const res = await callDo<{ ok: boolean; games: Array<{ id: number; created_at: number }> }>(env, {
    action: 'listDraftGames',
  });
  if (res.games.length === 0) {
    await ctx.reply('Нет черновиков игр.');
    return;
  }
  await ctx.reply(title, { reply_markup: draftGamesKeyboard(res.games, action) });
}
