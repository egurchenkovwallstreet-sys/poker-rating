import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createWebhookHandler } from './bot/commands';
import { stats } from './api/stats';
import type { Env } from './types';

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
