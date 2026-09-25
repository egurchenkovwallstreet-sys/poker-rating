# Покерный рейтинг

Telegram Mini App + бот для ведения статистики покерных игр внутри клуба.

## Архитектура

- **Worker** (Cloudflare) — API + Telegram-бот (grammY + Hono)
- **Durable Object** — хранение данных в SQLite
- **Mini App** (React + Vite) — просмотр статистики, хостинг на GitHub Pages

## Структура

```
poker-rating/
├── worker/     # Backend + бот
└── miniapp/    # Telegram Mini App
```

## Быстрый старт

### 1. Worker

```bash
cd poker-rating/worker
npm install
```

Создайте секреты в Cloudflare:

```bash
npx wrangler secret put BOT_TOKEN
```

Обновите `wrangler.toml`:

- `WEBAPP_URL` — URL Mini App на GitHub Pages
- `BOT_USERNAME` — username бота
- `ADMIN_IDS` — JSON-массив Telegram ID админов, например `[123456789,987654321]`

Локальная разработка:

```bash
npm run dev
```

Деплой:

```bash
npm run deploy
```

### 2. Webhook бота

После деплоя Worker установите webhook:

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<WORKER_URL>/webhook"
```

### 3. Mini App

```bash
cd poker-rating/miniapp
npm install
cp .env.example .env
# Укажите VITE_API_URL=https://<WORKER_URL>
npm run dev
```

Сборка:

```bash
npm run build
```

### 4. BotFather

В @BotFather укажите URL Mini App (Menu Button / Web App).

## Команды бота

| Команда | Описание |
|---------|----------|
| `/start` | Приветствие + кнопка Mini App |
| `/help` | Справка |
| `/admin` | Админ-меню (только админы) |
| `/addplayer <имя>` | Добавить игрока |
| `/removeplayer <имя>` | Удалить игрока |
| `/players` | Список игроков |
| `/newgame` | Новая игра |
| `/finishgame <id>` | Завершить игру |
| `/deletegame <id>` | Удалить игру |

## API (read-only)

Все эндпоинты требуют заголовок `X-Telegram-Init-Data`.

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/last-game` | Последняя игра |
| GET | `/api/month?month=YYYY-MM` | Статистика за месяц |
| GET | `/api/overall` | Общий рейтинг |
| GET | `/api/player/:id` | Профиль игрока |

## GitHub Actions

- `deploy-worker.yml` — деплой Worker (нужны `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`)
- `deploy-miniapp.yml` — деплой на GitHub Pages (нужна переменная `VITE_API_URL`)

## Секреты GitHub

| Secret / Variable | Описание |
|-------------------|----------|
| `CLOUDFLARE_API_TOKEN` | API-токен Cloudflare |
| `CLOUDFLARE_ACCOUNT_ID` | ID аккаунта Cloudflare |
| `VITE_API_URL` (variable) | URL Worker для сборки Mini App |
