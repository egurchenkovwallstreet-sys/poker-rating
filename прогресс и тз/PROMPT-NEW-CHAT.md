# Промпт для нового чата — копировать блок START … END

--- START ---

Ты продолжаешь проект **Telegram Mini App «Покерный рейтинг»**. Я **новичок** — объясняй **простыми словами**, **по одному шагу за сообщение**, unless I ask for more.

## Workspace

- `C:\Users\User\Покер бот\`
- **Только** `poker-rating/` (`worker/`, `miniapp/`). Старые `worker/` и `miniapp/` в корне workspace **не трогать**.
- Документы: `poker-rating/прогресс и тз/PROGRESS.md`, `TZ-SUMMARY.md`, этот файл.

## Архитектура

- Cloudflare Worker + grammY webhook + Hono API `/api/*`
- Durable Object `PokerRoom` (SQLite)
- Mini App React на GitHub Pages
- GitHub: https://github.com/egurchenkovwallstreet-sys/poker-rating

## Уже работает (зафиксировано 2026-09-27)

- Worker: https://poker-rating.e-gurchenkov-wallstreet.workers.dev (deploy `e812b2ef-8451-40fd-9738-b06566a5d724`)
- Бот **@poker_rating_bot**, `BOT_TOKEN` в Cloudflare (не просить токен в чате)
- `ADMIN_IDS = [1026681672, 853510383]`, `WEBAPP_URL` → https://egurchenkovwallstreet-sys.github.io/poker-rating/
- **Статистика у всех участников:** Mini App → `GET /api/public/stats`; бот **📊 Статистика** → inline «Открыть статистику». Commit **`25fa05f`**.
- **30 demo-игр** с результатами до `/cleardemo`; автопочинка `autoRepairStatsIfBroken` (не только для админа).
- Нижняя клавиатура: **Статистика**; у админа **Админ** → меню в **чате**
- Menu Button: **не** Web App; `/fixmenu` и `/start` сбрасывают
- Анонс → RSVP → старт → ввод результатов open-игры

## Статистика — не ломать

- Поломка: finished-игры **без** `game_results` → «N игр, 0 в рейтинге», пустой app.
- `finishGame` требует ≥2 строк результатов.
- Починка: `/refreshstats` (админ) или просто **📊 Статистика** (участник тоже триггерит repair).
- Подробности: **`PROGRESS.md`** → «Статистика Mini App + бот».

## Как работать

- PowerShell; worker: `npm run deploy` в `poker-rating/worker/`
- После изменений кода **сам делай git commit + push в `main`**
- Ответы на **русском**

Прочитай **`PROGRESS.md`**, затем продолжай задачи из «Следующие приоритеты» (правка результатов, UI, E2E).

--- END ---
