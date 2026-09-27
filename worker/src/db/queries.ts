import type { SqlStorage } from '@cloudflare/workers-types';
import { firstRow } from './query-helpers';
import {
  demoGameTimestamps,
  monthGameDateFilter,
  SQL_GAME_DATE_MS,
  SQL_GAME_DATE_MS_GAMES,
  SQL_GAME_IN_STATS,
  statsSinceMs,
} from './stats-time';
import type {
  Game,
  GameResult,
  GameWithResults,
  MonthStatRow,
  OverallStatRow,
  Player,
  PlayerProfile,
  PublicStatsSnapshot,
} from '../types';

export function initSchema(sql: SqlStorage, schemaSql: string): void {
  for (const statement of schemaSql.split(';').map((s) => s.trim()).filter(Boolean)) {
    sql.exec(statement);
  }
  migrateSchema(sql);
}

function migrateSchema(sql: SqlStorage): void {
  try {
    const cols = [...sql.exec('PRAGMA table_info(players)').toArray()] as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'avatar_file_id')) {
      sql.exec('ALTER TABLE players ADD COLUMN avatar_file_id TEXT');
    }
  } catch (e) {
    console.error('migrate players.avatar_file_id:', e);
  }
  try {
    sql.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_players_telegram_id ON players(telegram_id) WHERE telegram_id IS NOT NULL',
    );
  } catch (e) {
    console.error('migrate idx_players_telegram_id:', e);
  }
  migrateGamesTable(sql);
  try {
    sql.exec(`
      CREATE TABLE IF NOT EXISTS game_rsvps (
        game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        player_id INTEGER NOT NULL REFERENCES players(id),
        response TEXT NOT NULL CHECK(response IN ('yes', 'no')),
        queue_order INTEGER,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (game_id, player_id)
      )
    `);
    sql.exec('CREATE INDEX IF NOT EXISTS idx_game_rsvps_game ON game_rsvps(game_id)');
  } catch (e) {
    console.error('migrate game_rsvps:', e);
  }
  try {
    sql.exec(`
      CREATE TABLE IF NOT EXISTS game_invite_messages (
        game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        telegram_id INTEGER NOT NULL,
        message_id INTEGER NOT NULL,
        PRIMARY KEY (game_id, telegram_id)
      )
    `);
  } catch (e) {
    console.error('migrate game_invite_messages:', e);
  }
  try {
    sql.exec(`
      CREATE TABLE IF NOT EXISTS stats_snapshot (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  } catch (e) {
    console.error('migrate stats_snapshot:', e);
  }
  migrateNormalizeGameDates(sql);
}

/** Исправить даты игр, сохранённые в секундах вместо миллисекунд. */
export function migrateNormalizeGameDates(sql: SqlStorage): void {
  try {
    sql.exec(
      'UPDATE games SET date = date * 1000 WHERE date > 0 AND date < 10000000000',
    );
    sql.exec(
      'UPDATE games SET date = created_at WHERE (date IS NULL OR date <= 0) AND created_at > 0',
    );
    sql.exec(
      'UPDATE games SET date = CAST(date / 1000 AS INTEGER) WHERE date > 100000000000000',
    );
  } catch (e) {
    console.error('migrateNormalizeGameDates:', e);
  }
}

/** Завершённые игры без строк в game_results (после сбойной миграции DROP games). */
export function deleteFinishedGamesWithoutResults(sql: SqlStorage): number {
  try {
    const orphanIds = [
      ...sql
        .exec(
          `SELECT g.id FROM games g
           WHERE g.status = 'finished'
             AND NOT EXISTS (SELECT 1 FROM game_results gr WHERE gr.game_id = g.id)`,
        )
        .toArray(),
    ] as Array<{ id: number }>;
    for (const { id } of orphanIds) {
      deleteGame(sql, id);
    }
    return orphanIds.length;
  } catch (e) {
    console.error('deleteFinishedGamesWithoutResults:', e);
    return 0;
  }
}

export function repairClubStatsData(
  sql: SqlStorage,
  reseedDemoBy?: number,
): { orphansRemoved: number; reseeded: boolean; demoGames: number } {
  migrateGamesTable(sql);
  const orphansRemoved = deleteFinishedGamesWithoutResults(sql);
  repairFinishedGameDates(sql);
  let reseeded = false;
  if (reseedDemoBy != null) {
    seedDemo(sql, reseedDemoBy);
    reseeded = true;
  }
  refreshStatsSnapshot(sql);
  const demoGames =
    firstRow<{ c: number }>(
      sql,
      `SELECT COUNT(*) as c FROM games g
       WHERE g.status = 'finished' AND g.is_demo = 1
         AND EXISTS (SELECT 1 FROM game_results gr WHERE gr.game_id = g.id)`,
    )?.c ?? 0;
  return { orphansRemoved, reseeded, demoGames };
}

/** Игры с результатами, но дата вне окна 2 года — подставить created_at (часто после старых seed). */
export function repairFinishedGameDates(sql: SqlStorage): void {
  migrateNormalizeGameDates(sql);
  const since = statsSinceMs();
  try {
    sql.exec(
      `UPDATE games SET date = created_at
       WHERE status = 'finished'
         AND created_at >= ?
         AND id IN (SELECT DISTINCT game_id FROM game_results)
         AND ${SQL_GAME_DATE_MS_GAMES} < ?`,
      since,
      since,
    );
  } catch (e) {
    console.error('repairFinishedGameDates:', e);
  }
}

function migrateGamesTable(sql: SqlStorage): void {
  try {
    let cols = [...sql.exec('PRAGMA table_info(games)').toArray()] as Array<{ name: string }>;
    let names = cols.map((c) => c.name);
    if (!names.includes('ticket_price')) {
      sql.exec('ALTER TABLE games ADD COLUMN ticket_price INTEGER NOT NULL DEFAULT 0');
    }
    if (!names.includes('max_players')) {
      sql.exec('ALTER TABLE games ADD COLUMN max_players INTEGER NOT NULL DEFAULT 0');
    }

    const master = firstRow<{ sql: string }>(
      sql,
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='games'",
    );
    if (master?.sql && !master.sql.includes("'announced'")) {
      cols = [...sql.exec('PRAGMA table_info(games)').toArray()] as Array<{ name: string }>;
      names = cols.map((c) => c.name);
      const hasDemo = names.includes('is_demo');
      sql.exec('PRAGMA foreign_keys = OFF');
      sql.exec(`
        CREATE TABLE games_migrated (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date INTEGER NOT NULL,
          status TEXT NOT NULL,
          created_by INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          ticket_price INTEGER NOT NULL DEFAULT 0,
          max_players INTEGER NOT NULL DEFAULT 0,
          is_demo INTEGER NOT NULL DEFAULT 0
        )
      `);
      if (hasDemo) {
        sql.exec(`
          INSERT INTO games_migrated (id, date, status, created_by, created_at, ticket_price, max_players, is_demo)
          SELECT id, date, status, created_by, created_at,
            COALESCE(ticket_price, 0), COALESCE(max_players, 0), COALESCE(is_demo, 0)
          FROM games
        `);
      } else {
        sql.exec(`
          INSERT INTO games_migrated (id, date, status, created_by, created_at, ticket_price, max_players, is_demo)
          SELECT id, date, status, created_by, created_at,
            COALESCE(ticket_price, 0), COALESCE(max_players, 0),
            CASE WHEN status = 'finished' THEN 1 ELSE 0 END
          FROM games
        `);
      }
      sql.exec('DROP TABLE games');
      sql.exec('ALTER TABLE games_migrated RENAME TO games');
      sql.exec('CREATE INDEX IF NOT EXISTS idx_games_status ON games(status)');
      sql.exec('CREATE INDEX IF NOT EXISTS idx_games_date ON games(date)');
      sql.exec('PRAGMA foreign_keys = ON');
    }

    cols = [...sql.exec('PRAGMA table_info(games)').toArray()] as Array<{ name: string }>;
    names = cols.map((c) => c.name);
    if (!names.includes('is_demo')) {
      sql.exec('ALTER TABLE games ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0');
      sql.exec("UPDATE games SET is_demo = 1 WHERE status = 'finished'");
    } else {
      const demoCount =
        firstRow<{ c: number }>(sql, 'SELECT COUNT(*) as c FROM games WHERE is_demo = 1')?.c ?? 0;
      const finCount =
        firstRow<{ c: number }>(sql, "SELECT COUNT(*) as c FROM games WHERE status = 'finished'")?.c ??
        0;
      if (finCount > 0 && demoCount === 0) {
        sql.exec("UPDATE games SET is_demo = 1 WHERE status = 'finished'");
      }
    }
  } catch (e) {
    console.error('migrate games:', e);
  }
}

export function addPlayer(sql: SqlStorage, name: string, telegramId?: number): Player {
  const now = Date.now();
  sql.exec(
    'INSERT INTO players (name, telegram_id, created_at) VALUES (?, ?, ?)',
    name.trim(),
    telegramId ?? null,
    now,
  );
  const row = sql.exec('SELECT * FROM players WHERE name = ? COLLATE NOCASE', name.trim()).one();
  return row as unknown as Player;
}

export function removePlayer(sql: SqlStorage, name: string): boolean {
  const cursor = sql.exec('DELETE FROM players WHERE name = ? COLLATE NOCASE', name.trim());
  return cursor.rowsWritten > 0;
}

export function listPlayers(sql: SqlStorage): Player[] {
  return [...sql.exec('SELECT * FROM players ORDER BY name COLLATE NOCASE').toArray()] as unknown as Player[];
}

export function getPlayerById(sql: SqlStorage, id: number): Player | null {
  return firstRow<Player>(sql, 'SELECT * FROM players WHERE id = ?', id);
}

export function getPlayerByTelegramId(sql: SqlStorage, telegramId: number): Player | null {
  return firstRow<Player>(sql, 'SELECT * FROM players WHERE telegram_id = ?', telegramId);
}

export function registerPlayer(
  sql: SqlStorage,
  name: string,
  telegramId: number,
  avatarFileId?: string | null,
): Player {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Имя не может быть пустым');
  if (getPlayerByTelegramId(sql, telegramId)) throw new Error('Вы уже зарегистрированы');
  if (firstRow(sql, 'SELECT id FROM players WHERE name = ? COLLATE NOCASE', trimmed)) {
    throw new Error('Такое имя уже занято');
  }
  const now = Date.now();
  sql.exec(
    'INSERT INTO players (name, telegram_id, avatar_file_id, created_at) VALUES (?, ?, ?, ?)',
    trimmed,
    telegramId,
    avatarFileId ?? null,
    now,
  );
  return getPlayerByTelegramId(sql, telegramId)!;
}

export function updatePlayerName(sql: SqlStorage, telegramId: number, name: string): Player {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Имя не может быть пустым');
  const current = getPlayerByTelegramId(sql, telegramId);
  if (!current) throw new Error('Сначала зарегистрируйтесь: /register');
  if (
    firstRow(sql, 'SELECT id FROM players WHERE name = ? COLLATE NOCASE AND id != ?', trimmed, current.id)
  ) {
    throw new Error('Такое имя уже занято');
  }
  sql.exec('UPDATE players SET name = ? WHERE telegram_id = ?', trimmed, telegramId);
  return getPlayerByTelegramId(sql, telegramId)!;
}

export function removePlayerByTelegramId(sql: SqlStorage, telegramId: number): boolean {
  const cursor = sql.exec('DELETE FROM players WHERE telegram_id = ?', telegramId);
  return cursor.rowsWritten > 0;
}

export function setPlayerAvatar(sql: SqlStorage, telegramId: number, avatarFileId: string | null): Player {
  const current = getPlayerByTelegramId(sql, telegramId);
  if (!current) throw new Error('Сначала зарегистрируйтесь: /register');
  sql.exec('UPDATE players SET avatar_file_id = ? WHERE telegram_id = ?', avatarFileId, telegramId);
  return getPlayerByTelegramId(sql, telegramId)!;
}

export function createGame(
  sql: SqlStorage,
  playerIds: number[],
  createdBy: number,
  isDemo = false,
): number {
  const now = Date.now();
  sql.exec(
    `INSERT INTO games (date, status, created_by, created_at, ticket_price, max_players, is_demo)
     VALUES (?, 'draft', ?, ?, 0, 0, ?)`,
    now,
    createdBy,
    now,
    isDemo ? 1 : 0,
  );
  const game = sql.exec('SELECT id FROM games ORDER BY id DESC LIMIT 1').one() as { id: number };
  for (const playerId of playerIds) {
    sql.exec(
      'INSERT INTO game_results (game_id, player_id, buyin, payout, profit, place) VALUES (?, ?, 0, 0, 0, NULL)',
      game.id,
      playerId,
    );
  }
  return game.id;
}

export function addOrUpdateResult(
  sql: SqlStorage,
  gameId: number,
  playerId: number,
  buyin: number,
  payout: number,
  place?: number,
): void {
  const profit = payout - buyin;
  const existing = sql
    .exec('SELECT id FROM game_results WHERE game_id = ? AND player_id = ?', gameId, playerId)
    .one();
  if (existing) {
    sql.exec(
      'UPDATE game_results SET buyin = ?, payout = ?, profit = ?, place = ? WHERE game_id = ? AND player_id = ?',
      buyin,
      payout,
      profit,
      place ?? null,
      gameId,
      playerId,
    );
  } else {
    sql.exec(
      'INSERT INTO game_results (game_id, player_id, buyin, payout, profit, place) VALUES (?, ?, ?, ?, ?, ?)',
      gameId,
      playerId,
      buyin,
      payout,
      profit,
      place ?? null,
    );
  }
}

export function getGameProfitSum(sql: SqlStorage, gameId: number): number {
  const row = sql
    .exec('SELECT COALESCE(SUM(profit), 0) as total FROM game_results WHERE game_id = ?', gameId)
    .one() as { total: number };
  return row.total;
}

export function finishGame(sql: SqlStorage, gameId: number): { ok: true } | { ok: false; error: string } {
  const game = sql.exec('SELECT * FROM games WHERE id = ?', gameId).one();
  if (!game) return { ok: false, error: 'Игра не найдена' };
  if ((game as unknown as Game).status === 'finished') return { ok: false, error: 'Игра уже завершена' };

  const total = getGameProfitSum(sql, gameId);
  if (total !== 0) {
    return { ok: false, error: `Сумма profit должна быть 0, сейчас: ${total}` };
  }

  const results = sql
    .exec('SELECT player_id, profit FROM game_results WHERE game_id = ? ORDER BY profit DESC', gameId)
    .toArray() as Array<{ player_id: number; profit: number }>;

  let place = 1;
  for (let i = 0; i < results.length; i++) {
    if (i > 0 && results[i].profit < results[i - 1].profit) place = i + 1;
    sql.exec(
      'UPDATE game_results SET place = ? WHERE game_id = ? AND player_id = ?',
      place,
      gameId,
      results[i].player_id,
    );
  }

  sql.exec('UPDATE games SET status = ?, date = ? WHERE id = ?', 'finished', Date.now(), gameId);
  return { ok: true };
}

export function deleteGame(sql: SqlStorage, gameId: number): boolean {
  sql.exec('DELETE FROM game_results WHERE game_id = ?', gameId);
  const cursor = sql.exec('DELETE FROM games WHERE id = ?', gameId);
  return cursor.rowsWritten > 0;
}

export function getGameWithResults(sql: SqlStorage, gameId: number): GameWithResults | null {
  const game = firstRow<Game>(sql, 'SELECT * FROM games WHERE id = ?', gameId);
  if (!game) return null;

  const results = [
    ...sql
      .exec(
        `SELECT gr.*, p.name as player_name
         FROM game_results gr
         JOIN players p ON p.id = gr.player_id
         WHERE gr.game_id = ?
         ORDER BY gr.profit DESC`,
        gameId,
      )
      .toArray(),
  ] as unknown as Array<GameResult & { player_name: string }>;

  return { game: game as unknown as Game, results };
}

export function getLastGame(sql: SqlStorage): GameWithResults | null {
  migrateNormalizeGameDates(sql);
  migrateGamesTable(sql);
  const since = statsSinceMs();
  const baseSql = `SELECT g.* FROM games g
     WHERE g.status = 'finished'
       AND EXISTS (SELECT 1 FROM game_results gr WHERE gr.game_id = g.id)`;
  let game = firstRow<Game>(
    sql,
    `${baseSql} AND ${SQL_GAME_IN_STATS} ORDER BY ${SQL_GAME_DATE_MS} DESC LIMIT 1`,
    since,
  );
  if (!game) {
    game = firstRow<Game>(sql, `${baseSql} ORDER BY ${SQL_GAME_DATE_MS} DESC LIMIT 1`);
  }
  if (!game) return null;
  return getGameWithResults(sql, game.id);
}

export function getStatsDiagnostics(sql: SqlStorage): {
  finishedGames: number;
  resultRows: number;
  resultsLinkedToPlayers: number;
  orphanedResults: number;
  gamesInStatsWindow: number;
  minGameDate: number | null;
  maxGameDate: number | null;
  overallPlayers: number;
} {
  migrateNormalizeGameDates(sql);
  const since = statsSinceMs();
  const finishedGames =
    firstRow<{ c: number }>(sql, "SELECT COUNT(*) as c FROM games WHERE status = 'finished'")?.c ??
    0;
  const resultRows =
    firstRow<{ c: number }>(
      sql,
      `SELECT COUNT(*) as c FROM game_results gr
       JOIN games g ON g.id = gr.game_id WHERE g.status = 'finished'`,
    )?.c ?? 0;
  const resultsLinkedToPlayers =
    firstRow<{ c: number }>(
      sql,
      `SELECT COUNT(*) as c FROM game_results gr
       JOIN games g ON g.id = gr.game_id
       JOIN players p ON p.id = gr.player_id
       WHERE g.status = 'finished'`,
    )?.c ?? 0;
  const orphanedResults =
    firstRow<{ c: number }>(
      sql,
      `SELECT COUNT(*) as c FROM game_results gr
       JOIN games g ON g.id = gr.game_id
       LEFT JOIN players p ON p.id = gr.player_id
       WHERE g.status = 'finished' AND p.id IS NULL`,
    )?.c ?? 0;
  const gamesInStatsWindow =
    firstRow<{ c: number }>(
      sql,
      `SELECT COUNT(DISTINCT g.id) as c FROM games g
       JOIN game_results gr ON gr.game_id = g.id
       WHERE g.status = 'finished' AND ${SQL_GAME_IN_STATS}`,
      since,
    )?.c ?? 0;
  const mm = firstRow<{ mn: number | null; mx: number | null }>(
    sql,
    "SELECT MIN(date) as mn, MAX(date) as mx FROM games WHERE status = 'finished'",
  );
  return {
    finishedGames,
    resultRows,
    resultsLinkedToPlayers,
    orphanedResults,
    gamesInStatsWindow,
    minGameDate: mm?.mn ?? null,
    maxGameDate: mm?.mx ?? null,
    overallPlayers: getOverall(sql).length,
  };
}

export function getClubStatsSummary(sql: SqlStorage): {
  finishedGames: number;
  finishedGamesInStats: number;
  playersInRating: number;
  lastGameId: number | null;
  lastGamePlayers: number;
} {
  migrateNormalizeGameDates(sql);
  const since = statsSinceMs();
  const finishedGames =
    firstRow<{ c: number }>(
      sql,
      "SELECT COUNT(*) as c FROM games WHERE status = 'finished'",
    )?.c ?? 0;
  const finishedGamesInStats =
    firstRow<{ c: number }>(
      sql,
      `SELECT COUNT(*) as c FROM games g WHERE g.status = 'finished' AND ${SQL_GAME_IN_STATS}`,
      since,
    )?.c ?? 0;
  const overall = getOverall(sql);
  const last = getLastGame(sql);
  return {
    finishedGames,
    finishedGamesInStats,
    playersInRating: overall.length,
    lastGameId: last?.game.id ?? null,
    lastGamePlayers: last?.results.length ?? 0,
  };
}

/** Один round-trip к DO: вся статистика для Mini App (меньше таймаутов при нескольких пользователях). */
export function getStatsBundle(
  sql: SqlStorage,
  month: string,
): {
  summary: ReturnType<typeof getClubStatsSummary>;
  lastGame: GameWithResults | null;
  overall: OverallStatRow[];
  monthStats: MonthStatRow[];
} {
  migrateNormalizeGameDates(sql);
  const since = statsSinceMs();
  const overall = getOverall(sql);
  const lastGame = getLastGame(sql);
  const monthStats = getMonthStats(sql, month);
  const finishedGames =
    firstRow<{ c: number }>(
      sql,
      "SELECT COUNT(*) as c FROM games WHERE status = 'finished'",
    )?.c ?? 0;
  const finishedGamesInStats =
    firstRow<{ c: number }>(
      sql,
      `SELECT COUNT(*) as c FROM games g WHERE g.status = 'finished' AND ${SQL_GAME_IN_STATS}`,
      since,
    )?.c ?? 0;
  return {
    summary: {
      finishedGames,
      finishedGamesInStats,
      playersInRating: overall.length,
      lastGameId: lastGame?.game.id ?? null,
      lastGamePlayers: lastGame?.results.length ?? 0,
    },
    lastGame,
    overall,
    monthStats,
  };
}

function currentMonthKeyUtc(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function listStatsMonthsWithGames(sql: SqlStorage): string[] {
  migrateNormalizeGameDates(sql);
  const since = statsSinceMs();
  const rows = [
    ...sql
      .exec(
        `SELECT DISTINCT strftime('%Y-%m', datetime((${SQL_GAME_DATE_MS}) / 1000, 'unixepoch')) AS month_key
         FROM games g
         INNER JOIN game_results gr ON gr.game_id = g.id
         WHERE g.status = 'finished' AND ${SQL_GAME_IN_STATS}
         ORDER BY month_key DESC`,
        since,
      )
      .toArray(),
  ] as Array<{ month_key: string }>;
  return rows.map((r) => r.month_key).filter((m) => /^\d{4}-\d{2}$/.test(m));
}

export function buildPublicStatsSnapshot(sql: SqlStorage): PublicStatsSnapshot {
  const monthKey = currentMonthKeyUtc();
  const bundle = getStatsBundle(sql, monthKey);
  const months = listStatsMonthsWithGames(sql);
  const monthStats: Record<string, MonthStatRow[]> = {};
  for (const m of months.slice(0, 36)) {
    monthStats[m] = getMonthStats(sql, m);
  }
  const profiles: Record<string, PlayerProfile> = {};
  for (const row of bundle.overall) {
    const profile = getPlayerProfile(sql, row.player_id);
    if (profile) profiles[String(row.player_id)] = profile;
  }
  const testDemoGames =
    firstRow<{ c: number }>(
      sql,
      "SELECT COUNT(*) as c FROM games WHERE status = 'finished' AND is_demo = 1",
    )?.c ?? 0;
  return {
    updatedAt: Date.now(),
    club: {
      finishedGames: bundle.summary.finishedGames,
      playersInRating: bundle.summary.playersInRating,
      lastGamePlayers: bundle.summary.lastGamePlayers,
      testDemoGames,
    },
    lastGame: bundle.lastGame,
    overall: bundle.overall,
    months,
    monthStats,
    profiles,
  };
}

export function refreshStatsSnapshot(sql: SqlStorage): void {
  repairFinishedGameDates(sql);
  const payload = buildPublicStatsSnapshot(sql);
  if (payload.overall.length > 0) {
    persistStatsSnapshot(sql, payload);
    return;
  }
  const prev = readPersistedStatsSnapshot(sql);
  if (prev && prev.overall.length > 0) {
    return;
  }
  persistStatsSnapshot(sql, payload);
}

function readPersistedStatsSnapshot(sql: SqlStorage): PublicStatsSnapshot | null {
  const row = firstRow<{ payload: string }>(sql, 'SELECT payload FROM stats_snapshot WHERE id = 1');
  if (!row?.payload) return null;
  try {
    return JSON.parse(row.payload) as PublicStatsSnapshot;
  } catch {
    return null;
  }
}

function persistStatsSnapshot(sql: SqlStorage, payload: PublicStatsSnapshot): void {
  try {
    sql.exec(
      `INSERT INTO stats_snapshot (id, payload, updated_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
      JSON.stringify(payload),
      payload.updatedAt,
    );
  } catch (e) {
    console.error('stats_snapshot persist:', e);
  }
}

/** Mini App: только чтение. Не удаляем игры и не затираем снимок пустым ответом. */
export function getPublicStatsSnapshot(sql: SqlStorage): PublicStatsSnapshot {
  migrateGamesTable(sql);
  const cached = readPersistedStatsSnapshot(sql);
  if (cached && Array.isArray(cached.overall) && cached.overall.length > 0) {
    return cached;
  }

  repairFinishedGameDates(sql);
  const live = buildPublicStatsSnapshot(sql);
  if (live.overall.length > 0) {
    persistStatsSnapshot(sql, live);
    return live;
  }
  if (cached) {
    return cached;
  }
  return live;
}

export function listDraftGames(sql: SqlStorage): Game[] {
  return [
    ...sql.exec("SELECT * FROM games WHERE status = 'draft' ORDER BY created_at DESC").toArray(),
  ] as unknown as Game[];
}

export function listFinishedGames(sql: SqlStorage, limit = 20): Game[] {
  return [
    ...sql
      .exec("SELECT * FROM games WHERE status = 'finished' ORDER BY date DESC LIMIT ?", limit)
      .toArray(),
  ] as unknown as Game[];
}

export function getMonthStats(sql: SqlStorage, month: string): MonthStatRow[] {
  let range: { fromInclusive: number; toExclusive: number };
  try {
    const r = monthGameDateFilter(month);
    if (!r) return [];
    range = r;
  } catch {
    return [];
  }

  migrateNormalizeGameDates(sql);
  const since = statsSinceMs();
  const rows = [
    ...sql
      .exec(
        `SELECT
           gr.player_id as player_id,
           COALESCE(p.name, 'Игрок #' || gr.player_id) as name,
           COUNT(DISTINCT g.id) as games_count,
           COALESCE(SUM(gr.profit), 0) as total_profit,
           COALESCE(MAX(gr.profit), 0) as best_game,
           COALESCE(MIN(gr.profit), 0) as worst_game,
           SUM(CASE WHEN gr.profit > 0 THEN 1 ELSE 0 END) as wins
         FROM game_results gr
         JOIN games g ON g.id = gr.game_id
         LEFT JOIN players p ON p.id = gr.player_id
         WHERE g.status = 'finished'
           AND ${SQL_GAME_DATE_MS} >= ? AND ${SQL_GAME_DATE_MS} < ?
           AND (COALESCE(g.is_demo, 0) = 1 OR ${SQL_GAME_DATE_MS} >= ?)
         GROUP BY gr.player_id, p.name
         ORDER BY total_profit DESC`,
        range.fromInclusive,
        range.toExclusive,
        since,
      )
      .toArray(),
  ] as Array<{
    player_id: number;
    name: string;
    games_count: number;
    total_profit: number;
    best_game: number;
    worst_game: number;
    wins: number;
  }>;

  return rows.map((r) => ({
    ...r,
    winrate: r.games_count > 0 ? Math.round((r.wins / r.games_count) * 100) : 0,
  }));
}

function queryOverallRows(sql: SqlStorage, since: number, dateFilter: boolean): Array<{
  player_id: number;
  name: string;
  games_count: number;
  total_profit: number;
  total_buyin: number;
  wins: number;
}> {
  const whereDate = dateFilter
    ? `g.status = 'finished' AND ${SQL_GAME_IN_STATS}`
    : `g.status = 'finished'`;
  const params = dateFilter ? [since] : [];
  return [
    ...sql
      .exec(
        `SELECT
           gr.player_id as player_id,
           COALESCE(p.name, 'Игрок #' || gr.player_id) as name,
           COUNT(DISTINCT g.id) as games_count,
           COALESCE(SUM(gr.profit), 0) as total_profit,
           COALESCE(SUM(gr.buyin), 0) as total_buyin,
           SUM(CASE WHEN gr.profit > 0 THEN 1 ELSE 0 END) as wins
         FROM game_results gr
         JOIN games g ON g.id = gr.game_id
         LEFT JOIN players p ON p.id = gr.player_id
         WHERE ${whereDate}
         GROUP BY gr.player_id, p.name
         ORDER BY total_profit DESC`,
        ...params,
      )
      .toArray(),
  ] as Array<{
    player_id: number;
    name: string;
    games_count: number;
    total_profit: number;
    total_buyin: number;
    wins: number;
  }>;
}

export function getOverall(sql: SqlStorage): OverallStatRow[] {
  migrateNormalizeGameDates(sql);
  migrateGamesTable(sql);
  const since = statsSinceMs();
  let rows = queryOverallRows(sql, since, true);
  if (rows.length === 0) {
    const withResults =
      firstRow<{ c: number }>(
        sql,
        `SELECT COUNT(*) as c FROM games g
         WHERE g.status = 'finished'
           AND EXISTS (SELECT 1 FROM game_results gr WHERE gr.game_id = g.id)`,
      )?.c ?? 0;
    if (withResults > 0) {
      rows = queryOverallRows(sql, since, false);
    }
  }

  return rows.map((r, i) => ({
    player_id: r.player_id,
    name: r.name,
    place: i + 1,
    games_count: r.games_count,
    total_profit: r.total_profit,
    wins: r.wins,
    winrate: r.games_count > 0 ? Math.round((r.wins / r.games_count) * 100) : 0,
    roi: r.total_buyin > 0 ? Math.round((r.total_profit / r.total_buyin) * 100) : 0,
    streak: computeStreak(sql, r.player_id, since),
  }));
}

function computeStreak(sql: SqlStorage, playerId: number, since: number): number {
  const profits = [
    ...sql
      .exec(
        `SELECT gr.profit
         FROM game_results gr
         JOIN games g ON g.id = gr.game_id
         WHERE gr.player_id = ? AND g.status = 'finished' AND ${SQL_GAME_IN_STATS}
         ORDER BY ${SQL_GAME_DATE_MS} DESC
         LIMIT 20`,
        playerId,
        since,
      )
      .toArray(),
  ] as Array<{ profit: number }>;

  if (profits.length === 0) return 0;

  const sign = profits[0].profit >= 0 ? 1 : -1;
  let streak = 0;
  for (const p of profits) {
    const s = p.profit >= 0 ? 1 : -1;
    if (s === sign) streak += sign;
    else break;
  }
  return streak;
}

export function getPlayerProfile(sql: SqlStorage, playerId: number): PlayerProfile | null {
  migrateNormalizeGameDates(sql);
  let player = getPlayerById(sql, playerId);
  if (!player) {
    const hasResults = firstRow<{ c: number }>(
      sql,
      `SELECT COUNT(*) as c FROM game_results gr
       JOIN games g ON g.id = gr.game_id
       WHERE gr.player_id = ? AND g.status = 'finished'`,
      playerId,
    )?.c;
    if (!hasResults) return null;
    player = {
      id: playerId,
      name: `Игрок #${playerId}`,
      telegram_id: null,
      avatar_file_id: null,
      created_at: 0,
    };
  }

  const since = statsSinceMs();
  const statsRow = firstRow<{ games_count: number; total_profit: number }>(
    sql,
    `SELECT COUNT(DISTINCT g.id) as games_count, COALESCE(SUM(gr.profit), 0) as total_profit
     FROM game_results gr
     JOIN games g ON g.id = gr.game_id
     WHERE gr.player_id = ? AND g.status = 'finished' AND ${SQL_GAME_IN_STATS}`,
    playerId,
    since,
  );
  const stats = statsRow ?? { games_count: 0, total_profit: 0 };
  const gameProfits = [
    ...sql
      .exec(
        `SELECT g.id as game_id, g.date, gr.profit
         FROM game_results gr
         JOIN games g ON g.id = gr.game_id
         WHERE gr.player_id = ? AND g.status = 'finished' AND ${SQL_GAME_IN_STATS}
         ORDER BY ${SQL_GAME_DATE_MS} ASC`,
        playerId,
        since,
      )
      .toArray(),
  ] as Array<{ game_id: number; date: number; profit: number }>;

  let cumulative = 0;
  const chart = gameProfits.map((g) => {
    cumulative += g.profit;
    return { ...g, cumulative };
  });

  const history = [
    ...sql
      .exec(
        `SELECT g.id as game_id, g.date, gr.buyin, gr.payout, gr.profit, gr.place
         FROM game_results gr
         JOIN games g ON g.id = gr.game_id
         WHERE gr.player_id = ? AND g.status = 'finished' AND ${SQL_GAME_IN_STATS}
         ORDER BY ${SQL_GAME_DATE_MS} DESC
         LIMIT 10`,
        playerId,
        since,
      )
      .toArray(),
  ] as PlayerProfile['history'];

  return {
    player,
    games_count: stats.games_count,
    total_profit: stats.total_profit,
    chart,
    history,
  };
}

export function getSession(
  sql: SqlStorage,
  userId: number,
): { state: string; data: Record<string, unknown> } | null {
  const row = firstRow<{ state: string; data: string }>(
    sql,
    'SELECT state, data FROM bot_sessions WHERE user_id = ?',
    userId,
  );
  if (!row) return null;
  const r = row;
  return { state: r.state, data: JSON.parse(r.data || '{}') };
}

export function setSession(
  sql: SqlStorage,
  userId: number,
  state: string,
  data: Record<string, unknown>,
): void {
  const now = Date.now();
  const existing = firstRow(sql, 'SELECT user_id FROM bot_sessions WHERE user_id = ?', userId);
  const json = JSON.stringify(data);
  if (existing) {
    sql.exec('UPDATE bot_sessions SET state = ?, data = ?, updated_at = ? WHERE user_id = ?', state, json, now, userId);
  } else {
    sql.exec(
      'INSERT INTO bot_sessions (user_id, state, data, updated_at) VALUES (?, ?, ?, ?)',
      userId,
      state,
      json,
      now,
    );
  }
}

export function clearSession(sql: SqlStorage, userId: number): void {
  sql.exec('DELETE FROM bot_sessions WHERE user_id = ?', userId);
}

/** Удалить тестовые игры (только когда скажете убрать seed). */
export function clearDemoGames(sql: SqlStorage, refreshAfter = true): number {
  const ids = [
    ...sql.exec("SELECT id FROM games WHERE is_demo = 1").toArray(),
  ] as Array<{ id: number }>;
  for (const { id } of ids) {
    deleteGame(sql, id);
  }
  if (refreshAfter) refreshStatsSnapshot(sql);
  return ids.length;
}

export const DEMO_FINISHED_GAMES_TARGET = 30;

function countGameResultRows(sql: SqlStorage, gameId: number): number {
  return (
    firstRow<{ c: number }>(
      sql,
      'SELECT COUNT(*) as c FROM game_results WHERE game_id = ?',
      gameId,
    )?.c ?? 0
  );
}

/** Тестовые игроки (без telegram_id) и завершённые игры с результатами (Σ profit = 0). */
export function seedDemo(sql: SqlStorage, createdBy: number): {
  players: number;
  games: number;
  playerNames: string[];
  linkedAdmin: boolean;
  errors: string[];
} {
  migrateGamesTable(sql);
  clearDemoGames(sql, false);

  const names = ['Демо Иван', 'Демо Мария', 'Демо Олег', 'Демо Петр', 'Демо Саша', 'Демо Катя'];
  const playerIds: number[] = [];
  for (const name of names) {
    let row = firstRow<{ id: number }>(sql, 'SELECT id FROM players WHERE name = ? COLLATE NOCASE', name);
    if (!row) {
      addPlayer(sql, name);
      row = firstRow<{ id: number }>(sql, 'SELECT id FROM players WHERE name = ? COLLATE NOCASE', name)!;
    }
    playerIds.push(row.id);
  }

  /** [индекс игрока, бай-ин, стек] */
  const gameSets: Array<Array<[number, number, number]>> = [
    [
      [0, 1000, 2800],
      [1, 1000, 0],
      [2, 1000, 400],
      [3, 1000, 0],
      [4, 1000, 1800],
      [5, 1000, 1000],
    ],
    [
      [0, 2000, 0],
      [1, 2000, 4500],
      [2, 2000, 500],
      [3, 2000, 1500],
      [4, 2000, 3500],
      [5, 2000, 2000],
    ],
    [
      [0, 1500, 3200],
      [1, 1500, 800],
      [2, 1500, 0],
      [3, 1500, 2200],
      [4, 1500, 0],
      [5, 1500, 2800],
    ],
    [
      [0, 1000, 1500],
      [1, 1000, 500],
      [2, 1000, 0],
      [3, 1000, 1000],
      [4, 1000, 2000],
      [5, 1000, 1000],
    ],
  ];

  const registered = getPlayerByTelegramId(sql, createdBy);
  const rosterIds = (): number[] => {
    const base = playerIds.slice(0, 6);
    if (!registered) return base;
    const withoutSelf = base.filter((id) => id !== registered!.id);
    return [registered.id, ...withoutSelf].slice(0, 6);
  };

  const gameDates = demoGameTimestamps(DEMO_FINISHED_GAMES_TARGET);
  let gamesCreated = 0;
  const errors: string[] = [];
  for (let g = 0; g < DEMO_FINISHED_GAMES_TARGET; g++) {
    const set = gameSets[g % gameSets.length];
    const subsetIds = rosterIds();
    const unique = new Set(subsetIds);
    if (unique.size !== subsetIds.length) {
      errors.push(`Игра ${g + 1}: дубликаты игроков в составе`);
      continue;
    }
    const gameId = createGame(sql, subsetIds, createdBy, true);
    for (const [idx, buyin, payout] of set) {
      if (idx >= subsetIds.length) continue;
      addOrUpdateResult(sql, gameId, subsetIds[idx], buyin, payout);
    }
    const resultRows = countGameResultRows(sql, gameId);
    if (resultRows === 0) {
      errors.push(`Игра ${g + 1}: нет строк результатов`);
      deleteGame(sql, gameId);
      continue;
    }
    const fin = finishGame(sql, gameId);
    if (fin.ok) {
      gamesCreated++;
      sql.exec('UPDATE games SET date = ? WHERE id = ?', gameDates[g], gameId);
    } else {
      errors.push(`Игра ${g + 1}: ${fin.error}`);
      deleteGame(sql, gameId);
    }
  }

  refreshStatsSnapshot(sql);

  return {
    players: playerIds.length,
    games: gamesCreated,
    playerNames: names,
    linkedAdmin: !!registered,
    errors,
  };
}
