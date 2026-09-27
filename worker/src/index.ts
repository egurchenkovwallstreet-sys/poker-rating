import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createWebhookHandler } from './bot/commands';
import { stats } from './api/stats';
import { callDo } from './db/do-client';
import type { Env, PublicStatsSnapshot } from './types';

export { PokerRoom } from './durable/PokerRoom';

const app = new Hono<{ Bindings: Env }>();

app.use(
  '/api/*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'X-Telegram-Init-Data'],
    exposeHeaders: ['Content-Type'],
    maxAge: 86400,
  }),
);

app.onError((err, c) => {
  console.error('app error:', err);
  return c.json({ error: 'internal' }, 503);
});

/** Общая статистика клуба — без initData; обновляется при завершении игры. */
app.get('/api/public/stats', async (c) => {
  try {
    const res = await callDo<{ ok: boolean; snapshot: PublicStatsSnapshot }>(c.env, {
      action: 'getPublicStatsSnapshot',
    });
    c.header('Cache-Control', 'no-store, no-cache, must-revalidate');
    return c.json(res.snapshot);
  } catch (e) {
    console.error('public stats:', e);
    return c.json({ error: 'unavailable' }, 503);
  }
});

app.route('/api', stats);

app.post('/webhook', async (c) => {
  try {
    const handler = createWebhookHandler(c.env);
    return await handler(c.req.raw);
  } catch (e) {
    console.error('webhook error:', e);
    return c.text('OK', 200);
  }
});

app.get('/health', (c) => c.json({ ok: true }));

export default app;
