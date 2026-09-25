# Прогресс: Telegram Mini App «Покерный рейтинг»

Дата фиксации: 2026-09-26

## Цель по ТЗ

- Бот + API на **Cloudflare Worker** (без своего сервера)
- Данные в **Durable Object (SQLite)**
- Mini App на **GitHub Pages** (ещё не выложено)
- Админы: 2 человека по Telegram ID (сейчас один ID)

## Где лежит код

- Корень проекта: `C:\Users\User\Покер бот\poker-rating\`
- Backend: `poker-rating/worker/`
- Frontend: `poker-rating/miniapp/`
- Старые папки `worker/` и `miniapp/` в корне workspace **не трогали** — рабочая версия в `poker-rating/`

## Что уже сделано (код)

| Компонент | Статус |
|-----------|--------|
| Durable Object PokerRoom + схема БД | ✅ |
| grammY: команды, админ-меню, сценарий новой игры | ✅ |
| API read-only + initData | ✅ |
| Mini App: 4 экрана, TabBar, recharts | ✅ |
| `npm install` worker | ✅ |
| `npm run typecheck` worker | ✅ (после правок casts) |
| `npm run build` miniapp | ✅ |
| GitHub Actions workflows в репо | ✅ (деплой не настраивали) |

## Что сделал пользователь (инфраструктура)

| Шаг | Статус |
|-----|--------|
| Регистрация Cloudflare (вход через Google) | ✅ |
| `npx wrangler login` | ✅ Successfully logged in |
| Бот @BotFather | ✅ username: `poker_rating_bot` |
| Telegram ID админа | ✅ `1026681672` |
| `wrangler.toml`: BOT_USERNAME, ADMIN_IDS | ✅ |
| Секрет `BOT_TOKEN` в Cloudflare | ✅ (Worker создан при добавлении секрета) |
| Поддомен workers.dev | ✅ `e-gurchenkov-wallstreet.workers.dev` |
| `npm run deploy` | ✅ |

### URL Worker после деплоя

```
https://poker-rating.e-gurchenkov-wallstreet.workers.dev
```

- Health: `GET /health` → `{"ok":true}`
- Webhook endpoint: `POST /webhook`

### Webhook Telegram

- Установлен через браузер: `setWebhook?url=.../webhook`
- Ответ API: `"ok":true,"result":true,"description":"Webhook was set"`

### Текущая проблема

- **Бот не ответил на `/start`** после установки webhook (нужна диагностика в новом чате).

### Что ещё не сделано по ТЗ

- [ ] Починить ответ бота на команды
- [ ] GitHub репозиторий + деплой Mini App на Pages
- [ ] Обновить `WEBAPP_URL` в `wrangler.toml` (сейчас заглушка `YOUR_USERNAME.github.io`)
- [ ] Переменная `VITE_API_URL` для сборки miniapp
- [ ] Menu Button / Web App в @BotFather
- [ ] Полный тест: addplayer → newgame → finish → Mini App
- [ ] Git remote / коммиты (локальный git в workspace без remote)

## Настройки wrangler.toml (на момент деплоя)

- `name = "poker-rating"`
- `BOT_USERNAME = "poker_rating_bot"`
- `ADMIN_IDS = "[1026681672]"`
- `WEBAPP_URL = "https://YOUR_USERNAME.github.io/poker-rating/"` — **заменить позже**

## Cloudflare (из дашборда)

- Account ID: `b9063e87381f63acf6e086468d2d86de`
- Subdomain: `e-gurchenkov-wallstreet.workers.dev`
- Worker в списке: `poker-rating` (после первого деплоя — deployments есть)

## Безопасность

⚠️ **Токен бота был виден в URL браузера на скриншоте.** Рекомендуется в @BotFather: `/revoke` или перевыпустить токен, затем снова `npx wrangler secret put BOT_TOKEN` и переустановить webhook.

**Не хранить токен в git, в чатах и в markdown-файлах.**

## Полезные команды (PowerShell)

```powershell
cd "C:\Users\User\Покер бот\poker-rating\worker"
npm run deploy
npx wrangler secret put BOT_TOKEN
npx wrangler tail
```

Проверка webhook (подставить токен локально, не публиковать):

```
https://api.telegram.org/bot<TOKEN>/getWebhookInfo
```

## Ссылка на ТЗ

Исходное ТЗ — в первом сообщении чата / копия в `TZ-SUMMARY.md` в этой папке.
