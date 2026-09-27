/** Окно статистики (~2 года). Старше — не показываем, из БД не удаляем. */
export const STATS_RETENTION_MS = Math.round(2 * 365.25 * 24 * 60 * 60 * 1000);

export function statsSinceMs(nowMs: number = Date.now()): number {
  return nowMs - STATS_RETENTION_MS;
}

/**
 * Дата игры в БД: миллисекунды. Старые записи могли сохраниться в секундах — приводим в SQL.
 * Порог 1e11: секунды 2026 (~1.7e9) < 1e11; ms 2026 (~1.7e12) > 1e11.
 */
function gameDateMsExpr(prefix: string): string {
  return `(CASE
  WHEN ${prefix}.date IS NULL OR ${prefix}.date <= 0 THEN ${prefix}.created_at
  WHEN ${prefix}.date < 10000000000 THEN ${prefix}.date * 1000
  ELSE ${prefix}.date
END)`;
}

/** Секунды (< 1e10) → ms; иначе уже ms. Пустая date → created_at. */
export const SQL_GAME_DATE_MS = gameDateMsExpr('g');
export const SQL_GAME_DATE_MS_GAMES = gameDateMsExpr('games');

/** Календарный месяц `YYYY-MM` в UTC. */
export function monthRangeUtc(month: string): { start: number; end: number } {
  const [year, mon] = month.split('-').map(Number);
  if (!year || !mon || mon < 1 || mon > 12) {
    throw new Error(`Invalid month: ${month}`);
  }
  return {
    start: Date.UTC(year, mon - 1, 1),
    end: Date.UTC(year, mon, 1),
  };
}

/** Диапазон дат игр для вкладки «Месяц» с учётом окна 2 года. null = нет пересечения. */
export function monthGameDateFilter(
  month: string,
  nowMs: number = Date.now(),
): { fromInclusive: number; toExclusive: number } | null {
  const { start, end } = monthRangeUtc(month);
  const since = statsSinceMs(nowMs);
  const fromInclusive = Math.max(start, since);
  if (fromInclusive >= end) return null;
  return { fromInclusive, toExclusive: end };
}

export function isGameDateInMonth(
  gameDateMs: number,
  month: string,
  nowMs: number = Date.now(),
): boolean {
  const range = monthGameDateFilter(month, nowMs);
  if (!range) return false;
  return gameDateMs >= range.fromInclusive && gameDateMs < range.toExclusive;
}

export function isGameDateInStatsWindow(gameDateMs: number, nowMs: number = Date.now()): boolean {
  return gameDateMs >= statsSinceMs(nowMs);
}

/** Даты demo-игр: по одной в каждый из последних `count` календарных месяцев (UTC). */
export function demoGameTimestamps(count: number, nowMs: number = Date.now()): number[] {
  const now = new Date(nowMs);
  const timestamps: number[] = [];
  for (let i = 0; i < count; i++) {
    const monthsAgo = count - 1 - i;
    timestamps.push(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 15, 20, 0, 0),
    );
  }
  return timestamps;
}
