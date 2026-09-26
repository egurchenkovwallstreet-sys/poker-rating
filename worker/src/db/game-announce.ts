import type { SqlStorage } from '@cloudflare/workers-types';
import type { Game, Player } from '../types';
import { firstRow } from './query-helpers';

export function getGameById(sql: SqlStorage, gameId: number): Game | null {
  return firstRow<Game>(sql, 'SELECT * FROM games WHERE id = ?', gameId);
}

export function listRegisteredPlayers(sql: SqlStorage): Player[] {
  return [
    ...sql
      .exec('SELECT * FROM players WHERE telegram_id IS NOT NULL ORDER BY name COLLATE NOCASE')
      .toArray(),
  ] as unknown as Player[];
}

export function createAnnouncedGame(
  sql: SqlStorage,
  scheduledDate: number,
  ticketPrice: number,
  maxPlayers: number,
  createdBy: number,
): number {
  if (maxPlayers < 1) throw new Error('Нужен хотя бы 1 игрок');
  if (ticketPrice < 0) throw new Error('Билет не может быть отрицательным');
  const now = Date.now();
  sql.exec(
    `INSERT INTO games (date, status, created_by, created_at, ticket_price, max_players)
     VALUES (?, 'announced', ?, ?, ?, ?)`,
    scheduledDate,
    createdBy,
    now,
    ticketPrice,
    maxPlayers,
  );
  const row = sql.exec('SELECT id FROM games ORDER BY id DESC LIMIT 1').one() as { id: number };
  return row.id;
}

export function countRsvpYes(sql: SqlStorage, gameId: number): number {
  const row = sql
    .exec(
      "SELECT COUNT(*) as c FROM game_rsvps WHERE game_id = ? AND response = 'yes'",
      gameId,
    )
    .one() as { c: number };
  return row.c;
}

export function listAnnouncedGames(sql: SqlStorage): Game[] {
  return [
    ...sql
      .exec(
        "SELECT * FROM games WHERE status IN ('announced', 'registration_full') ORDER BY date ASC",
      )
      .toArray(),
  ] as unknown as Game[];
}

export function setGameRsvp(
  sql: SqlStorage,
  gameId: number,
  playerId: number,
  response: 'yes' | 'no',
): {
  ok: boolean;
  error?: string;
  registrationClosed?: boolean;
  yesCount?: number;
  queueOrder?: number | null;
} {
  const game = getGameById(sql, gameId);
  if (!game) return { ok: false, error: 'Игра не найдена' };
  if (game.status === 'open' || game.status === 'finished' || game.status === 'draft') {
    return { ok: false, error: 'Запись на эту игру уже закрыта' };
  }

  const now = Date.now();
  const existing = firstRow<{ response: string; queue_order: number | null }>(
    sql,
    'SELECT response, queue_order FROM game_rsvps WHERE game_id = ? AND player_id = ?',
    gameId,
    playerId,
  );

  if (response === 'no') {
    if (existing?.response === 'yes') {
      sql.exec('DELETE FROM game_rsvps WHERE game_id = ? AND player_id = ?', gameId, playerId);
      renumberRsvpQueue(sql, gameId);
      if (game.status === 'registration_full') {
        sql.exec("UPDATE games SET status = 'announced' WHERE id = ?", gameId);
      }
    } else {
      sql.exec(
        `INSERT INTO game_rsvps (game_id, player_id, response, queue_order, created_at)
         VALUES (?, ?, 'no', NULL, ?)
         ON CONFLICT(game_id, player_id) DO UPDATE SET response = 'no', queue_order = NULL, created_at = excluded.created_at`,
        gameId,
        playerId,
        now,
      );
    }
    return { ok: true, yesCount: countRsvpYes(sql, gameId), queueOrder: null };
  }

  if (game.status === 'registration_full' && existing?.response !== 'yes') {
    return { ok: false, error: 'Все места заняты' };
  }

  const yesCount = countRsvpYes(sql, gameId);
  if (existing?.response === 'yes') {
    return { ok: true, yesCount, queueOrder: existing.queue_order };
  }

  if (yesCount >= game.max_players) {
    return { ok: false, error: 'Все места заняты' };
  }

  const queueOrder = yesCount + 1;
  sql.exec(
    `INSERT INTO game_rsvps (game_id, player_id, response, queue_order, created_at)
     VALUES (?, ?, 'yes', ?, ?)
     ON CONFLICT(game_id, player_id) DO UPDATE SET response = 'yes', queue_order = excluded.queue_order, created_at = excluded.created_at`,
    gameId,
    playerId,
    queueOrder,
    now,
  );

  let registrationClosed = false;
  if (queueOrder >= game.max_players) {
    sql.exec("UPDATE games SET status = 'registration_full' WHERE id = ?", gameId);
    registrationClosed = true;
  }

  return { ok: true, yesCount: queueOrder, queueOrder, registrationClosed };
}

function renumberRsvpQueue(sql: SqlStorage, gameId: number): void {
  const rows = [
    ...sql
      .exec(
        "SELECT player_id FROM game_rsvps WHERE game_id = ? AND response = 'yes' ORDER BY queue_order ASC, created_at ASC",
        gameId,
      )
      .toArray(),
  ] as Array<{ player_id: number }>;
  let order = 1;
  for (const row of rows) {
    sql.exec(
      'UPDATE game_rsvps SET queue_order = ? WHERE game_id = ? AND player_id = ?',
      order,
      gameId,
      row.player_id,
    );
    order++;
  }
}

export function startAnnouncedGame(
  sql: SqlStorage,
  gameId: number,
): { ok: true; roster: Player[] } | { ok: false; error: string } {
  const game = getGameById(sql, gameId);
  if (!game) return { ok: false, error: 'Игра не найдена' };
  if (game.status !== 'announced' && game.status !== 'registration_full') {
    return { ok: false, error: 'Эту игру нельзя стартовать' };
  }
  sql.exec("UPDATE games SET status = 'open' WHERE id = ?", gameId);
  const roster = [
    ...sql
      .exec(
        `SELECT p.* FROM game_rsvps r
         JOIN players p ON p.id = r.player_id
         WHERE r.game_id = ? AND r.response = 'yes'
         ORDER BY r.queue_order ASC`,
        gameId,
      )
      .toArray(),
  ] as unknown as Player[];
  return { ok: true, roster };
}

export function saveInviteMessage(
  sql: SqlStorage,
  gameId: number,
  telegramId: number,
  messageId: number,
): void {
  sql.exec(
    `INSERT INTO game_invite_messages (game_id, telegram_id, message_id) VALUES (?, ?, ?)
     ON CONFLICT(game_id, telegram_id) DO UPDATE SET message_id = excluded.message_id`,
    gameId,
    telegramId,
    messageId,
  );
}

export function listInviteMessages(
  sql: SqlStorage,
  gameId: number,
): Array<{ telegram_id: number; message_id: number }> {
  return [
    ...sql
      .exec('SELECT telegram_id, message_id FROM game_invite_messages WHERE game_id = ?', gameId)
      .toArray(),
  ] as Array<{ telegram_id: number; message_id: number }>;
}

export function listRsvpYesPlayers(sql: SqlStorage, gameId: number): Player[] {
  return [
    ...sql
      .exec(
        `SELECT p.* FROM game_rsvps r
         JOIN players p ON p.id = r.player_id
         WHERE r.game_id = ? AND r.response = 'yes'
         ORDER BY r.queue_order ASC, r.created_at ASC`,
        gameId,
      )
      .toArray(),
  ] as unknown as Player[];
}

export function listOpenGames(sql: SqlStorage): Game[] {
  return [
    ...sql.exec("SELECT * FROM games WHERE status = 'open' ORDER BY date ASC").toArray(),
  ] as unknown as Game[];
}

/** Строки в game_results для всех RSVP «yes»; игра должна быть в статусе open. */
export function prepareOpenGameForResults(
  sql: SqlStorage,
  gameId: number,
): { ok: true; playerIds: number[]; ticketPrice: number } | { ok: false; error: string } {
  const game = getGameById(sql, gameId);
  if (!game) return { ok: false, error: 'Игра не найдена' };
  if (game.status !== 'open') {
    return { ok: false, error: 'Результаты вносятся только для игры после «Старт» (статус open)' };
  }

  const roster = listRsvpYesPlayers(sql, gameId);
  if (roster.length < 2) {
    return { ok: false, error: 'Нужно минимум 2 участника с ответом «Участвую»' };
  }

  for (const p of roster) {
    const existing = firstRow<{ id: number }>(
      sql,
      'SELECT id FROM game_results WHERE game_id = ? AND player_id = ?',
      gameId,
      p.id,
    );
    if (!existing) {
      sql.exec(
        'INSERT INTO game_results (game_id, player_id, buyin, payout, profit, place) VALUES (?, ?, 0, 0, 0, NULL)',
        gameId,
        p.id,
      );
    }
  }

  return { ok: true, playerIds: roster.map((p) => p.id), ticketPrice: game.ticket_price };
}

export function getRsvpSummary(
  sql: SqlStorage,
  gameId: number,
): { yesCount: number; maxPlayers: number; spotsLeft: number } {
  const game = getGameById(sql, gameId);
  if (!game) return { yesCount: 0, maxPlayers: 0, spotsLeft: 0 };
  const yesCount = countRsvpYes(sql, gameId);
  return {
    yesCount,
    maxPlayers: game.max_players,
    spotsLeft: Math.max(0, game.max_players - yesCount),
  };
}
