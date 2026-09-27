import { Hono } from 'hono';
import type { Context } from 'hono';
import { callDo } from '../db/do-client';
import { isAdmin, parseAdminIds, validateInitData } from './auth';
import type { Env } from '../types';

type ApiEnv = {
  Bindings: Env;
  Variables: {
    auth: { userId: number };
  };
};

const stats = new Hono<ApiEnv>();

async function readInitData(c: Context<ApiEnv>): Promise<string> {
  const fromHeader = c.req.header('X-Telegram-Init-Data');
  if (fromHeader) return fromHeader;
  const fromQuery = c.req.query('initData');
  if (fromQuery) return fromQuery;
  if (c.req.method === 'POST') {
    try {
      const body = await c.req.json<{ initData?: string }>();
      if (body?.initData) return body.initData;
    } catch {
      /* empty body */
    }
  }
  return '';
}

stats.use('*', async (c, next) => {
  const initData = await readInitData(c);
  const auth = validateInitData(initData, c.env.BOT_TOKEN);
  if (!auth) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  c.set('auth', auth);
  await next();
});

async function meHandler(c: Context<ApiEnv>) {
  const auth = c.get('auth');
  const admins = parseAdminIds(c.env.ADMIN_IDS);
  const summaryRes = await callDo<{
    ok: boolean;
    summary: {
      finishedGames: number;
      playersInRating: number;
      lastGamePlayers: number;
    };
  }>(c.env, { action: 'getClubStatsSummary' });
  return c.json({
    userId: auth.userId,
    isAdmin: isAdmin(auth.userId, admins),
    club: summaryRes.summary,
  });
}

async function lastGameHandler(c: Context<ApiEnv>) {
  const result = await callDo<{ ok: boolean; data: unknown }>(c.env, { action: 'getLastGame' });
  return c.json(result.data);
}

async function monthHandler(c: Context<ApiEnv>) {
  const month = c.req.query('month') || currentMonth();
  const result = await callDo<{ ok: boolean; stats: unknown }>(c.env, {
    action: 'getMonthStats',
    month,
  });
  return c.json({ month, stats: result.stats });
}

async function overallHandler(c: Context<ApiEnv>) {
  const result = await callDo<{ ok: boolean; stats: unknown }>(c.env, { action: 'getOverall' });
  return c.json({ stats: result.stats });
}

async function playerHandler(c: Context<ApiEnv>) {
  const playerId = parseInt(c.req.param('id') || '', 10);
  if (isNaN(playerId)) return c.json({ error: 'Invalid id' }, 400);
  const result = await callDo<{ ok: boolean; profile: unknown }>(c.env, {
    action: 'getPlayer',
    playerId,
  });
  return c.json(result.profile);
}

for (const method of ['get', 'post'] as const) {
  stats[method]('/me', meHandler);
  stats[method]('/last-game', lastGameHandler);
  stats[method]('/month', monthHandler);
  stats[method]('/overall', overallHandler);
  stats[method]('/player/:id', playerHandler);
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export { stats };
