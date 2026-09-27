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

## Уже работает

- Worker: https://poker-rating.e-gurchenkov-wallstreet.workers.dev
- Бот **@poker_rating_bot**, `BOT_TOKEN` в Cloudflare (не просить токен в чате)
- `ADMIN_IDS = [1026681672, 853510383]`, `WEBAPP_URL` → https://egurchenkovwallstreet-sys.github.io/poker-rating/
- Нижняя клавиатура: **Статистика** → inline «Открыть статистику»; у админа **Админ** → меню в **чате** (не Mini App)
- Боковая Menu Button: **не** Web App; `/fixmenu` и `/start` сбрасывают; при необходимости BotFather → Default
- `/seeddemo` и админ «🧪 Тестовые данные» — demo-игроки и завершённые игры в БД
- Анонс → RSVP → старт → ввод результатов open-игры

## Задача этого чата (главная)

**Изучи проект** (worker + miniapp + API stats) и **настрой тестовую статистику для отображения** в Mini App:

- Проверь, что после `/seeddemo` (или доработанного seed) на вкладках **Last game / Month / Overall / Profile** есть понятные данные, без пустых экранов и ошибок auth.
- При необходимости: улучши `seedDemo` в `worker/src/db/queries.ts`, API `worker/src/api/stats.ts`, страницы в `miniapp/src/pages/*`.
- Учти: demo без `telegram_id` — для Overall/Month/Last; Profile — для зарегистрированного игрока (см. `PROGRESS.md` → «Тестовая статистика»).
- Объясняй, что ты делаешь и как мне проверить в Telegram (коротко): `/seeddemo` → «Статистика» → «Открыть статистику».

## Как работать

- Один шаг → жди «готово», unless I ask for more
- PowerShell; worker: `npm run deploy` в `poker-rating/worker/`
- После изменений кода **сам делай git commit + push в `main`** (у меня так настроен Cursor)
- Ответы на **русском**

Прочитай `PROGRESS.md`, затем начни с **аудита seed + Mini App** и первого конкретного шага к нормальной тестовой статистике.

--- END ---
