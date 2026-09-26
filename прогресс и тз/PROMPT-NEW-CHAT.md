# Промпт для нового чата — копировать блок START … END

--- START ---

Ты продолжаешь проект **Telegram Mini App «Покерный рейтинг»**. Я новичок — объясняй **простыми словами**, **по одному шагу за сообщение**, unless I ask for more.

## Workspace

- `C:\Users\User\Покер бот\`
- **Только** `poker-rating/` (`worker/`, `miniapp/`). Старые `worker/` и `miniapp/` в корне workspace **не трогать**.
- Документы: `poker-rating/прогресс и тз/PROGRESS.md`, `TZ-SUMMARY.md`

## Архитектура

- Cloudflare Worker + grammY webhook + Hono API `/api/*`
- Durable Object `PokerRoom` (SQLite)
- Mini App React на GitHub Pages
- GitHub: https://github.com/egurchenkovwallstreet-sys/poker-rating

## Уже работает

- Worker: https://poker-rating.e-gurchenkov-wallstreet.workers.dev (`/health`, `/webhook`)
- Бот **@poker_rating_bot**, секрет `BOT_TOKEN` в Cloudflare (не просить токен в чате)
- `ADMIN_IDS = [1026681672]`, `WEBAPP_URL` → GitHub Pages
- Mini App: https://egurchenkovwallstreet-sys.github.io/poker-rating/ (`VITE_API_URL` в GitHub Variables)
- `/start`, `/register`, `/admin`, Mini App с таблицами (`/seeddemo` для тест-данных)
- **Анонс игры:** дата, билет, макс. игроков → личка всем **зарегистрированным** → «Участvую/Нет» → sync списка + короткие уведомления всем → админ **Старт** (`open`)

## Cloudflare

- Account ID: `b9063e87381f63acf6e086468d2d86de`
- Subdomain: `e-gurchenkov-wallstreet.workers.dev`
- Worker name: `poker-rating`

## Следующие задачи (порядок)

1. **Ввод результатов** после игры в статусе `open` (участники из RSVP «yes») → `finished`, profit sum = 0.
2. **Правка результатов:** первый ввод без голосования; повторная правка — уведомление игрокам этой игры, кнопки Подтвердить/Отклонить, **>50%** для применения.
3. Mini App: главная, топ-3, аватары, (позже) статусы-шутки — отложено.
4. BotFather **Menu Button** → Mini App.
5. E2E: register → announce → RSVP → start → results → Mini App.

## Правила игроков (зафиксировано)

- Уникальные имена; профиль только сам; RSVP только после `/register`.
- «Чат» = личка бота у зарегистрированных, не группа Telegram.

## Безопасность

- Токен не в git/чат. На Windows: `BOT_TOKEN` через файл в `wrangler secret put`. При утечке — revoke + новый secret + webhook.

## Как работать

- Один шаг → жди «готово»
- PowerShell, можешь сам деплоить (`npm run deploy` в `worker/`)
- Ответы на русском

Прочитай `PROGRESS.md` и начни с **первого незакрытого пункта** (ввод результатов после `open`), одним шагом.

--- END ---
