# Промпт для нового чата (полный текст — копировать от линии START до END)

--- START ---

Ты продолжаешь проект **Telegram Mini App «Покерный рейтинг»**. Я новичок — объясняй простыми словами, **по одному шагу за сообщение**, unless I ask for more.

## Контекст

- Workspace: `C:\Users\User\Покер бот\`
- **Рабочий код только здесь:** `poker-rating/` (подпапки `worker/` и `miniapp/`)
- **Не ломать** другие проекты; **не трогать** старые `worker/` и `miniapp/` в корне workspace (если есть)
- Документация прогресса: `poker-rating/прогресс и тз/PROGRESS.md`, `TZ-SUMMARY.md`

## Архитектура (по ТЗ)

- Cloudflare Worker + grammY webhook + Hono API
- Durable Object `PokerRoom` с SQLite
- Mini App React на GitHub Pages (ещё не задеплоено)
- Без своего VPS, без Google/Vercel/Firebase

## Уже сделано

1. Код backend и miniapp написан, собирается
2. Cloudflare: `wrangler login` OK
3. Бот: username **`poker_rating_bot`**, токен в секрете Cloudflare `BOT_TOKEN` (не спрашивай токен в чате)
4. `wrangler.toml`: `ADMIN_IDS = [1026681672]`, `BOT_USERNAME = poker_rating_bot`, `WEBAPP_URL` — заглушка github.io
5. Deploy OK: **https://poker-rating.e-gurchenkov-wallstreet.workers.dev**
6. Webhook установлен на `.../webhook`, Telegram API ответил Webhook was set
7. **Проблема:** бот **не ответил** на `/start` — это **первый приоритет**

## Cloudflare

- Subdomain: `e-gurchenkov-wallstreet.workers.dev`
- Account ID: `b9063e87381f63acf6e086468d2d86de`
- Worker name: `poker-rating`

## Безопасность

Токен бота светился в URL на скрине — при необходимости подскажи `/revoke` в BotFather, `wrangler secret put BOT_TOKEN`, заново setWebhook. **Не пиши токен в ответах.**

## Твои задачи (порядок)

1. **Диагностика /start:** `getWebhookInfo`, `GET /health`, `wrangler tail`, логи Worker, совпадение секрета и бота, ошибки grammY на Workers
2. **Исправить** код/конфиг если нужно, redeploy
3. Проверить `/start`, `/admin`, `/addplayer` для ID 1026681672
4. **Mini App:** GitHub Pages, `VITE_API_URL`, обновить `WEBAPP_URL`, BotFather menu button
5. E2E тест по ТЗ

## Как работать со мной

- Один шаг → жди «готово»
- Команды для **Windows PowerShell**
- Можешь сам запускать терминал в Cursor
- Ответы на русском

Начни с **шага 1 диагностики**: что проверить первым и одна команда/одна ссылка для меня.

--- END ---
