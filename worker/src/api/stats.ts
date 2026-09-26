import { Hono } from 'hono';
import { callDo } from '../db/do-client';
import { isAdmin, parseAdminIds, validateInitData } from './auth';
import type { Env } from '../types';

type ApiEnv = { Bindings: Env };

const stats = new Hono<ApiEnv>();

function getAuth(c: { req: { header: (n: string) => string | undefined; query: (n: string) => string | undefined }; env: Env }) {
  const initData = c.req.header('X-Telegram-Init-Data') || c.req.query('initData') || '';
  return validateInitData(initData, c.env.BOT_TOKEN);
}

stats.use('*', async (c, next) => {
  if (!getAuth(c)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
});

stats.get('/me', async (c) => {
  const auth = getAuth(c)!;
  const admins = parseAdminIds(c.env.ADMIN_IDS);
  return c.json({ userId: auth.userId, isAdmin: isAdmin(auth.userId, admins) });
});

stats.get('/last-game', async (c) => {
  const result = await callDo<{ ok: boolean; data: unknown }>(c.env, { action: 'getLastGame' });
  return c.json(result.data);
});

stats.get('/month', async (c) => {
  const month = c.req.query('month') || currentMonth();
  const result = await callDo<{ ok: boolean; stats: unknown }>(c.env, {
    action: 'getMonthStats',
    month,
  });
  return c.json({ month, stats: result.stats });
});

stats.get('/overall', async (c) => {
  const result = await callDo<{ ok: boolean; stats: unknown }>(c.env, { action: 'getOverall' });
  return c.json({ stats: result.stats });
});

stats.get('/player/:id', async (c) => {
  const playerId = parseInt(c.req.param('id'), 10);
  if (isNaN(playerId)) return c.json({ error: 'Invalid id' }, 400);
  const result = await callDo<{ ok: boolean; profile: unknown }>(c.env, {
    action: 'getPlayer',
    playerId,
  });
  return c.json(result.profile);
});

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export { stats };
