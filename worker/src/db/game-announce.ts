import type { SqlStorage } from '@cloudflare/workers-types';
import type { Game, Player } from '../types';
import { firstRow } from './query-helpers';

/** Единственная таблица записей «Участvую» (старая game_rsvps в проде могла быть битой). */
const RSVP_TABLE = 'game_rsvp_registrations';

export function normalizeGameId(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.floor(raw);
  const n = parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) ? n : NaN;
}

/** Все «yes» с других незавершённых игр → на одну (актуальный анонс / старт). */
function mergeYesRsvpsToGame(sql: SqlStorage, targetGameId: number): void {
  ensureRsvpRegistrationsTable(sql);
  sql.exec(
    `UPDATE ${RSVP_TABLE}
     SET game_id = ?
     WHERE response = 'yes'
       AND game_id != ?
       AND game_id IN (
         SELECT id FROM games WHERE status IN ('draft', 'announced', 'registration_full')
       )`,
    targetGameId,
    targetGameId,
  );
}

export function ensureRsvpRegistrationsTable(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS ${RSVP_TABLE} (
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL REFERENCES players(id),
      response TEXT NOT NULL CHECK(response IN ('yes', 'no')),
      created_at INTEGER NOT NULL,
      PRIMARY KEY (game_id, player_id)
    )
  `);
  sql.exec(`CREATE INDEX IF NOT EXISTS idx_rsvp_reg_game ON ${RSVP_TABLE}(game_id)`);
  const imported = getClubMeta(sql, 'rsvp_reg_imported');
  if (imported !== '1') {
    try {
      sql.exec(`
        INSERT OR IGNORE INTO ${RSVP_TABLE} (game_id, player_id, response, created_at)
        SELECT game_id, player_id, response, created_at FROM game_rsvps
        WHERE rowid IN (
          SELECT MIN(rowid) FROM game_rsvps GROUP BY game_id, player_id
        )
      `);
    } catch {
      /* game_rsvps может отсутствовать */
    }
    setClubMeta(sql, 'rsvp_reg_imported', '1');
  }
}

export function getLatestAnnouncedGameId(sql: SqlStorage): number | null {
  return (
    firstRow<{ id: number }>(
      sql,
      `SELECT id FROM games
       WHERE status IN ('announced', 'registration_full')
       ORDER BY id DESC LIMIT 1`,
    )?.id ?? null
  );
}

function gameRsvpsPkColumnNames(sql: SqlStorage): string[] {
  try {
    const pkCols = [
      ...sql
        .exec(`SELECT name, pk FROM pragma_table_info('game_rsvps') ORDER BY pk`)
        .toArray(),
    ] as Array<{ name: string; pk: number }>;
    return pkCols.filter((c) => c.pk > 0).map((c) => c.name);
  } catch {
    return [];
  }
}

function gameRsvpsHasCompositePrimaryKey(sql: SqlStorage): boolean {
  const names = gameRsvpsPkColumnNames(sql);
  return names.length === 2 && names.includes('game_id') && names.includes('player_id');
}

function hasUniqueIndexOnlyOnGameId(sql: SqlStorage): boolean {
  try {
    const indexes = [
      ...sql.exec("PRAGMA index_list('game_rsvps')").toArray(),
    ] as Array<{ name: string; unique: number }>;
    for (const idx of indexes) {
      if (!idx.unique) continue;
      const cols = [
        ...sql.exec(`PRAGMA index_info('${idx.name}')`).toArray(),
      ] as Array<{ name: string }>;
      if (cols.length === 1 && cols[0].name === 'game_id') return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function ensureClubMetaTable(sql: SqlStorage): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS club_meta (key TEXT PRIMARY KEY, value TEXT)`);
}

function getClubMeta(sql: SqlStorage, key: string): string | null {
  ensureClubMetaTable(sql);
  return firstRow<{ value: string }>(sql, 'SELECT value FROM club_meta WHERE key = ?', key)?.value ?? null;
}

function setClubMeta(sql: SqlStorage, key: string, value: string): void {
  ensureClubMetaTable(sql);
  sql.exec('INSERT OR REPLACE INTO club_meta (key, value) VALUES (?, ?)', key, value);
}

const GAME_RSVPS_SCHEMA_VERSION = '3';

function gameRsvpsTableHealthy(sql: SqlStorage): boolean {
  const master = firstRow<{ sql: string }>(
    sql,
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='game_rsvps'",
  );
  if (!master?.sql) return false;
  if (!gameRsvpsHasCompositePrimaryKey(sql)) return false;
  if (hasUniqueIndexOnlyOnGameId(sql)) return false;
  if (gameRsvpsPkColumnNames(sql).length === 1) return false;
  return true;
}

function createGameRsvpsTableSql(tableName: string): string {
  return `
    CREATE TABLE ${tableName} (
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL REFERENCES players(id),
      response TEXT NOT NULL CHECK(response IN ('yes', 'no')),
      queue_order INTEGER,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (game_id, player_id)
    )
  `;
}

/** Безопасная пересборка: не DROP исходной таблицы, пока данные не скопированы. */
function rebuildGameRsvpsTableSafe(sql: SqlStorage): void {
  const master = firstRow<{ sql: string }>(
    sql,
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='game_rsvps'",
  );
  if (!master?.sql) {
    sql.exec(createGameRsvpsTableSql('game_rsvps'));
    sql.exec('CREATE INDEX IF NOT EXISTS idx_game_rsvps_game ON game_rsvps(game_id)');
    return;
  }

  sql.exec('DROP TABLE IF EXISTS game_rsvps_new');
  sql.exec('PRAGMA foreign_keys = OFF');
  sql.exec(createGameRsvpsTableSql('game_rsvps_new'));
  sql.exec(`
    INSERT INTO game_rsvps_new (game_id, player_id, response, queue_order, created_at)
    SELECT game_id, player_id, response, queue_order, created_at FROM game_rsvps
    WHERE rowid IN (
      SELECT MIN(rowid) FROM game_rsvps GROUP BY game_id, player_id
    )
  `);
  const srcRows =
    firstRow<{ c: number }>(sql, 'SELECT COUNT(*) as c FROM game_rsvps')?.c ?? 0;
  const dstRows =
    firstRow<{ c: number }>(sql, 'SELECT COUNT(*) as c FROM game_rsvps_new')?.c ?? 0;
  const srcYes =
    firstRow<{ c: number }>(
      sql,
      "SELECT COUNT(*) as c FROM game_rsvps WHERE response = 'yes'",
    )?.c ?? 0;
  const dstYes =
    firstRow<{ c: number }>(
      sql,
      "SELECT COUNT(*) as c FROM game_rsvps_new WHERE response = 'yes'",
    )?.c ?? 0;
  if (srcYes > 0 && dstYes === 0) {
    sql.exec('DROP TABLE IF EXISTS game_rsvps_new');
    sql.exec('PRAGMA foreign_keys = ON');
    console.error('rebuildGameRsvpsTableSafe: refused — would lose yes rows', { srcRows, dstRows, srcYes });
    return;
  }
  sql.exec('DROP TABLE game_rsvps');
  sql.exec('ALTER TABLE game_rsvps_new RENAME TO game_rsvps');
  sql.exec('CREATE INDEX IF NOT EXISTS idx_game_rsvps_game ON game_rsvps(game_id)');
  sql.exec('PRAGMA foreign_keys = ON');
}

/** Ошибочный UNIQUE/PK только на game_id → в игре может быть только 1 RSVP. */
function dropBadGameRsvpsUniqueIndexes(sql: SqlStorage): void {
  try {
    const indexes = [
      ...sql.exec("PRAGMA index_list('game_rsvps')").toArray(),
    ] as Array<{ name: string; unique: number }>;
    for (const idx of indexes) {
      if (!idx.unique) continue;
      const cols = [
        ...sql.exec(`PRAGMA index_info('${idx.name}')`).toArray(),
      ] as Array<{ name: string }>;
      if (cols.length === 1 && cols[0].name === 'game_id') {
        sql.exec(`DROP INDEX IF EXISTS "${idx.name}"`);
      }
    }
  } catch (e) {
    console.error('dropBadGameRsvpsUniqueIndexes:', e);
  }
}

export function ensureGameRsvpsSchema(sql: SqlStorage): void {
  try {
    const version = getClubMeta(sql, 'game_rsvps_schema');
    const healthy = gameRsvpsTableHealthy(sql);
    if (version === GAME_RSVPS_SCHEMA_VERSION && healthy) {
      dropBadGameRsvpsUniqueIndexes(sql);
      return;
    }
    rebuildGameRsvpsTableSafe(sql);
    dropBadGameRsvpsUniqueIndexes(sql);
    if (!gameRsvpsTableHealthy(sql)) {
      rebuildGameRsvpsTableSafe(sql);
      dropBadGameRsvpsUniqueIndexes(sql);
    }
    setClubMeta(sql, 'game_rsvps_schema', GAME_RSVPS_SCHEMA_VERSION);
  } catch (e) {
    console.error('ensureGameRsvpsSchema:', e);
  }
}

/** @deprecated use ensureGameRsvpsSchema */
export function migrateGameRsvpsTable(sql: SqlStorage): void {
  ensureGameRsvpsSchema(sql);
}

export function getGameById(sql: SqlStorage, gameId: number): Game | null {
  return firstRow<Game>(sql, 'SELECT * FROM games WHERE id = ?', gameId);
}

function registrationCap(game: Game): number {
  const raw = Number(game.max_players);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 999;
}

/** max_players=0 в старых строках ломало slice(0,0) → пустой состав при старте. */
export function effectiveMaxPlayers(game: Game, yesCount: number): number {
  const raw = Number(game.max_players);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return Math.max(yesCount, 1);
}

export function repairGameMaxPlayersIfZero(sql: SqlStorage, gameId: number): void {
  const game = getGameById(sql, gameId);
  if (!game) return;
  const raw = Number(game.max_players);
  if (Number.isFinite(raw) && raw > 0) return;
  const yesCount = countRsvpYes(sql, gameId);
  const fixed = Math.max(yesCount, 8);
  sql.exec('UPDATE games SET max_players = ? WHERE id = ?', fixed, gameId);
}

export function listRegisteredPlayers(sql: SqlStorage): Player[] {
  return [
    ...sql
      .exec('SELECT * FROM players WHERE telegram_id IS NOT NULL ORDER BY name COLLATE NOCASE')
      .toArray(),
  ] as unknown as Player[];
}

/** Перед RSVP: нормальный лимит мест и открытая запись, если есть свободные места. */
function normalizeAnnouncedGameForRsvp(sql: SqlStorage, gameId: number): Game | null {
  ensureRsvpRegistrationsTable(sql);
  let game = getGameById(sql, gameId);
  if (!game) return null;
  let max = Number(game.max_players);
  if (!Number.isFinite(max) || max < 2) {
    sql.exec('UPDATE games SET max_players = 8 WHERE id = ?', gameId);
    game = getGameById(sql, gameId)!;
  }
  const yes = countRsvpYes(sql, gameId);
  const cap = registrationCap(game);
  if (game.status === 'registration_full' && yes < cap) {
    sql.exec("UPDATE games SET status = 'announced' WHERE id = ?", gameId);
    game = getGameById(sql, gameId)!;
  }
  return game;
}

function upsertRsvpYes(sql: SqlStorage, gameId: number, playerId: number, now: number): void {
  sql.exec(
    `INSERT INTO ${RSVP_TABLE} (game_id, player_id, response, created_at)
     VALUES (?, ?, 'yes', ?)
     ON CONFLICT(game_id, player_id) DO UPDATE SET
       response = 'yes',
       created_at = CASE
         WHEN ${RSVP_TABLE}.response = 'yes' THEN ${RSVP_TABLE}.created_at
         ELSE excluded.created_at
       END`,
    gameId,
    playerId,
    now,
  );
}

export function createAnnouncedGame(
  sql: SqlStorage,
  scheduledDate: number,
  ticketPrice: number,
  maxPlayers: number,
  createdBy: number,
): number {
  if (maxPlayers < 2) throw new Error('Минимум 2 места на игру (введите например 8)');
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
  const gameId = row.id;
  ensureRsvpRegistrationsTable(sql);
  mergeYesRsvpsToGame(sql, gameId);
  sql.exec(
    `UPDATE games SET status = 'draft'
     WHERE status IN ('announced', 'registration_full') AND id != ?`,
    gameId,
  );
  return gameId;
}

export function countRsvpYes(sql: SqlStorage, gameId: number): number {
  ensureRsvpRegistrationsTable(sql);
  const row = sql
    .exec(
      `SELECT COUNT(*) as c FROM ${RSVP_TABLE} WHERE game_id = ? AND response = 'yes'`,
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

/** Удалить только лишние дубликаты (game_id + player_id), не трогая единственную строку. */
function dedupeGameRsvps(sql: SqlStorage, gameId: number): void {
  try {
    sql.exec(
      `DELETE FROM ${RSVP_TABLE}
       WHERE game_id = ? AND rowid IN (
         SELECT r.rowid FROM ${RSVP_TABLE} r
         WHERE r.game_id = ?
           AND r.rowid > (
             SELECT MIN(r2.rowid) FROM ${RSVP_TABLE} r2
             WHERE r2.game_id = r.game_id AND r2.player_id = r.player_id
           )
       )`,
      gameId,
      gameId,
    );
  } catch (e) {
    console.error('dedupeGameRsvps:', e);
  }
}

/** Место в очереди: кто раньше нажал «Участvую» (created_at), при равенстве — player_id. */
export function getRsvpQueueOrder(
  sql: SqlStorage,
  gameId: number,
  playerId: number,
): number | null {
  dedupeGameRsvps(sql, gameId);
  ensureRsvpRegistrationsTable(sql);
  const me = firstRow<{ created_at: number; response: string }>(
    sql,
    `SELECT created_at, response FROM ${RSVP_TABLE}
     WHERE game_id = ? AND player_id = ?
     ORDER BY rowid ASC LIMIT 1`,
    gameId,
    playerId,
  );
  if (!me || me.response !== 'yes') return null;
  const row = firstRow<{ ord: number }>(
    sql,
    `SELECT 1 + COUNT(*) as ord
     FROM ${RSVP_TABLE} r
     WHERE r.game_id = ? AND r.response = 'yes'
       AND (r.created_at < ? OR (r.created_at = ? AND r.player_id < ?))`,
    gameId,
    me.created_at,
    me.created_at,
    playerId,
  );
  return row?.ord ?? 1;
}

/** Место в очереди = порядок первого «Участvую» (created_at), не MAX(queue_order). */
export function renumberRsvpQueue(sql: SqlStorage, gameId: number): void {
  dedupeGameRsvps(sql, gameId);
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
  ensureRsvpRegistrationsTable(sql);
  const game = normalizeAnnouncedGameForRsvp(sql, gameId);
  if (!game) return { ok: false, error: 'Игра не найдена' };
  if (game.status === 'open' || game.status === 'finished') {
    return { ok: false, error: 'Запись на эту игру уже закрыта' };
  }
  if (game.status === 'draft') {
    const latest = getLatestAnnouncedGameId(sql);
    return {
      ok: false,
      error: latest
        ? `Старое сообщение (игра #${gameId}). Запись только в анонсе 🆔 #${latest}.`
        : `Игра #${gameId} закрыта. Дождитесь нового анонса от админа.`,
    };
  }

  const now = Date.now();
  const existing = firstRow<{ response: string }>(
    sql,
    `SELECT response FROM ${RSVP_TABLE} WHERE game_id = ? AND player_id = ?`,
    gameId,
    playerId,
  );

  if (response === 'no') {
    if (existing?.response === 'yes') {
      sql.exec(`DELETE FROM ${RSVP_TABLE} WHERE game_id = ? AND player_id = ?`, gameId, playerId);
      renumberRsvpQueue(sql, gameId);
      if (game.status === 'registration_full') {
        sql.exec("UPDATE games SET status = 'announced' WHERE id = ?", gameId);
      }
    } else {
      sql.exec(
        `INSERT INTO ${RSVP_TABLE} (game_id, player_id, response, created_at)
         VALUES (?, ?, 'no', ?)
         ON CONFLICT(game_id, player_id) DO UPDATE SET response = 'no', created_at = excluded.created_at`,
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
    renumberRsvpQueue(sql, gameId);
    const slot = getRsvpQueueOrder(sql, gameId, playerId);
    return { ok: true, yesCount: countRsvpYes(sql, gameId), queueOrder: slot };
  }

  const capNow = registrationCap(game);
  if (yesCount >= capNow) {
    return { ok: false, error: `Все ${capNow} мест заняты` };
  }

  const yesBefore = countRsvpYes(sql, gameId);

  try {
    upsertRsvpYes(sql, gameId, playerId, now);
  } catch (e) {
    console.error('upsertRsvpYes:', e);
    return {
      ok: false,
      error:
        'Не удалось записать в очередь (база). Админ: новый анонс. Участник: /register и снова «Участvую».',
    };
  }

  dedupeGameRsvps(sql, gameId);
  renumberRsvpQueue(sql, gameId);

  const finalYesCount = countRsvpYes(sql, gameId);
  const slot = getRsvpQueueOrder(sql, gameId, playerId);
  const inQueue = listRsvpYesWithQueue(sql, gameId).some(
    (r) => Number(r.player_id) === Number(playerId),
  );

  if (finalYesCount <= yesBefore || slot == null || !inQueue) {
    return {
      ok: false,
      error:
        `Запись не сохранилась (было ${yesBefore}, стало ${finalYesCount}). Новый анонс с 🆔 #${gameId}.`,
    };
  }

  const gameFresh = getGameById(sql, gameId)!;
  let registrationClosed = false;
  if (finalYesCount >= registrationCap(gameFresh)) {
    sql.exec("UPDATE games SET status = 'registration_full' WHERE id = ?", gameId);
    registrationClosed = true;
  }

  return { ok: true, yesCount: finalYesCount, queueOrder: slot, registrationClosed };
}

export function startAnnouncedGame(
  sql: SqlStorage,
  gameId: number,
): {
  ok: true;
  roster: Player[];
  yesCount: number;
  startedGameId: number;
  requestedGameId: number;
  mergedFromOtherGames?: boolean;
} | { ok: false; error: string } {
  ensureRsvpRegistrationsTable(sql);
  const requestedGameId = normalizeGameId(gameId);
  if (!Number.isFinite(requestedGameId)) {
    return { ok: false, error: 'Неверный номер игры' };
  }

  const latestAnnounced = getLatestAnnouncedGameId(sql);
  let startedGameId = requestedGameId;
  if (latestAnnounced != null) {
    startedGameId = latestAnnounced;
  }

  const yesBeforeMerge = countRsvpYes(sql, startedGameId);
  mergeYesRsvpsToGame(sql, startedGameId);
  const mergedFromOtherGames = countRsvpYes(sql, startedGameId) > yesBeforeMerge;

  let game = getGameById(sql, startedGameId);
  if (!game) return { ok: false, error: 'Игра не найдена' };

  if (game.status === 'draft' && countRsvpYes(sql, startedGameId) > 0) {
    sql.exec("UPDATE games SET status = 'announced' WHERE id = ?", startedGameId);
    game = getGameById(sql, startedGameId)!;
  }

  if (game.status !== 'announced' && game.status !== 'registration_full') {
    return {
      ok: false,
      error: `Игра #${startedGameId} в статусе «${game.status}». Нужен анонс → «Участvую» → старт.`,
    };
  }
  renumberRsvpQueue(sql, startedGameId);
  repairGameMaxPlayersIfZero(sql, startedGameId);
  const gameFresh = getGameById(sql, startedGameId)!;
  const yesOnly = countRsvpYes(sql, startedGameId);
  const allYes = listRsvpYesPlayersRobust(sql, startedGameId);
  const cap = effectiveMaxPlayers(gameFresh, Math.max(allYes.length, yesOnly));
  const roster = allYes.slice(0, cap);
  if (roster.length === 0) {
    const otherGames = [
      ...sql
        .exec(
          `SELECT g.id as game_id, COUNT(*) as yes_count
           FROM ${RSVP_TABLE} r
           JOIN games g ON g.id = r.game_id
           WHERE r.response = 'yes'
             AND g.status IN ('announced', 'registration_full')
             AND g.id != ?
           GROUP BY g.id
           HAVING yes_count > 0
           ORDER BY yes_count DESC`,
          startedGameId,
        )
        .toArray(),
    ] as Array<{ game_id: number; yes_count: number }>;
    const hint =
      otherGames.length > 0
        ? `\n\nЗаписи «Участвую» на другие игры: ${otherGames.map((g) => `#${g.game_id} (${g.yes_count} чел.)`).join(', ')}. Стартуйте ту, где на кнопке «N/… запис.»`
        : '';
    return {
      ok: false,
      error:
        yesOnly > 0
          ? `На игру #${startedGameId} есть ${yesOnly} RSVP, но состав не собрался.${hint}`
          : `На игру #${startedGameId} никто не нажал «Участвую».${hint}`,
    };
  }
  ensureGameResultsRowsForRoster(sql, startedGameId, roster);
  sql.exec("UPDATE games SET status = 'open' WHERE id = ?", startedGameId);
  return {
    ok: true,
    roster,
    yesCount: roster.length,
    startedGameId,
    requestedGameId,
    mergedFromOtherGames,
  };
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
  return listRsvpYesPlayersRobust(sql, gameId);
}

/** Состав для старта: JOIN + запасной путь только по player_id из RSVP. */
export function listRsvpYesPlayersRobust(sql: SqlStorage, gameId: number): Player[] {
  ensureRsvpRegistrationsTable(sql);
  const rows = [
    ...sql
      .exec(
        `SELECT
           COALESCE(p.id, r.player_id) as id,
           COALESCE(p.name, 'Игрок #' || r.player_id) as name,
           p.telegram_id,
           p.avatar_file_id,
           COALESCE(p.created_at, r.created_at) as created_at
         FROM ${RSVP_TABLE} r
         LEFT JOIN players p ON p.id = r.player_id
         WHERE r.game_id = ? AND r.response = 'yes'
         ORDER BY r.created_at ASC, r.player_id ASC`,
        gameId,
      )
      .toArray(),
  ] as unknown as Player[];
  if (rows.length > 0) return rows;

  const yesCount = countRsvpYes(sql, gameId);
  if (yesCount === 0) return [];

  const idRows = [
    ...sql
      .exec(
        `SELECT player_id, created_at FROM ${RSVP_TABLE}
         WHERE game_id = ? AND response = 'yes'
         ORDER BY created_at ASC, player_id ASC`,
        gameId,
      )
      .toArray(),
  ] as Array<{ player_id: number; created_at: number }>;

  const out: Player[] = [];
  for (const row of idRows) {
    const p = firstRow<Player>(sql, 'SELECT * FROM players WHERE id = ?', row.player_id);
    out.push(
      p ?? {
        id: row.player_id,
        name: `Игрок #${row.player_id}`,
        telegram_id: null,
        avatar_file_id: null,
        created_at: row.created_at,
      },
    );
  }
  return out;
}

function ensureGameResultsRowsForRoster(sql: SqlStorage, gameId: number, roster: Player[]): void {
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
}

export function listRsvpYesWithQueue(
  sql: SqlStorage,
  gameId: number,
): Array<{ queue_order: number; name: string; player_id: number }> {
  ensureRsvpRegistrationsTable(sql);
  dedupeGameRsvps(sql, gameId);
  const rows = [
    ...sql
      .exec(
        `SELECT
           COALESCE(p.name, 'Игрок #' || r.player_id) as name,
           r.player_id as r_player_id,
           r.created_at
         FROM ${RSVP_TABLE} r
         LEFT JOIN players p ON p.id = r.player_id
         WHERE r.game_id = ? AND r.response = 'yes'
         ORDER BY r.created_at ASC, r.player_id ASC`,
        gameId,
      )
      .toArray(),
  ] as Array<{ name: string; created_at: number; r_player_id: number }>;
  return rows.map((r, i) => ({
    queue_order: i + 1,
    name: r.name,
    player_id: r.r_player_id,
  }));
}

export function getRsvpDebugInfo(
  sql: SqlStorage,
  gameId: number,
): {
  game: Game | null;
  pkColumns: string[];
  tableSql: string | null;
  badGameIdUnique: boolean;
  yesRows: Array<{ player_id: number; name: string; created_at: number; queue_order: number | null }>;
  yesCount: number;
  otherAnnouncedWithYes: Array<{ game_id: number; yes_count: number }>;
} {
  ensureRsvpRegistrationsTable(sql);
  const game = getGameById(sql, gameId);
  const master = firstRow<{ sql: string }>(
    sql,
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='${RSVP_TABLE}'`,
  );
  const yesRows = [
    ...sql
      .exec(
        `SELECT r.player_id, r.created_at,
                COALESCE(p.name, 'Игрок #' || r.player_id) as name
         FROM ${RSVP_TABLE} r
         LEFT JOIN players p ON p.id = r.player_id
         WHERE r.game_id = ? AND r.response = 'yes'
         ORDER BY r.created_at ASC, r.player_id ASC`,
        gameId,
      )
      .toArray(),
  ] as Array<{ player_id: number; name: string; created_at: number }>;
  const otherAnnouncedWithYes = [
    ...sql
      .exec(
        `SELECT g.id as game_id, COUNT(*) as yes_count
         FROM ${RSVP_TABLE} r
         JOIN games g ON g.id = r.game_id
         WHERE r.response = 'yes'
           AND g.status IN ('announced', 'registration_full')
         GROUP BY g.id
         ORDER BY yes_count DESC`,
      )
      .toArray(),
  ] as Array<{ game_id: number; yes_count: number }>;
  const latestAnnounced = getLatestAnnouncedGameId(sql);
  return {
    game,
    pkColumns: gameRsvpsPkColumnNames(sql),
    tableSql: master?.sql ?? null,
    badGameIdUnique: hasUniqueIndexOnlyOnGameId(sql),
    yesRows,
    yesCount: yesRows.length,
    otherAnnouncedWithYes,
    latestAnnounced,
  };
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
