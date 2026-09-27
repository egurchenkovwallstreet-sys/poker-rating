# Прогресс: Telegram Mini App «Покерный рейтинг»

Дата обновления: **2026-09-27** (поздний вечер — **статистика работает у всех участников**, проверено владельцем)

## Цель

- Бот + API на **Cloudflare Worker**
- Данные в **Durable Object (SQLite)**
- Mini App на **GitHub Pages**
- Админы по Telegram ID в `ADMIN_IDS`

## Где код

- Корень: `C:\Users\User\Покер бот\poker-rating\`
- Backend: `worker/`
- Frontend: `miniapp/`
- Документация: `прогресс и тз/`
- GitHub: https://github.com/egurchenkovwallstreet-sys/poker-rating
- **Не трогать** старые `worker/` и `miniapp/` в корне workspace (если есть)

---

## Инфраструктура (готово)

| Компонент | Статус |
|-----------|--------|
| Cloudflare, `wrangler login` | ✅ |
| Worker `poker-rating` | ✅ https://poker-rating.e-gurchenkov-wallstreet.workers.dev |
| Webhook `/webhook` | ✅ |
| Секрет `BOT_TOKEN` (через файл, не одним символом) | ✅ |
| Бот @**poker_rating_bot** | ✅ |
| GitHub repo + push | ✅ |
| GitHub Pages (Actions `deploy-miniapp.yml`) | ✅ |
| Variable `VITE_API_URL` = Worker URL | ✅ |
| `WEBAPP_URL` = `https://egurchenkovwallstreet-sys.github.io/poker-rating/` | ✅ |

### Cloudflare

- Account ID: `b9063e87381f63acf6e086468d2d86de`
- Subdomain: `e-gurchenkov-wallstreet.workers.dev`
- Последний деплой worker (2026-09-27): Version ID `e812b2ef-8451-40fd-9738-b06566a5d724`

### wrangler.toml (актуально)

- `ADMIN_IDS = "[1026681672,853510383]"`
- `BOT_USERNAME = "poker_rating_bot"`
- `WEBAPP_URL = "https://egurchenkovwallstreet-sys.github.io/poker-rating/"`

---

## UX бота и Mini App (2026-09-26 — 2026-09-27)

Согласовано с владельцем:

| Элемент | Поведение |
|---------|-----------|
| Нижняя клавиатура (не зарег.) | **✍️ Регистрация** |
| Нижняя клавиатура (игрок) | **📊 Статистика** → бот отвечает в чате + inline **«Открыть статистику»** (Web App, надёжный `initData`) |
| Нижняя клавиатура (админ) | **🔧 Админ** + **📊 Статистика** |
| **🔧 Админ** | Только **чат**: inline-меню «Игроки / Игры» (как `/admin`). **Не** открывает Mini App |
| **Mini App** | Только **статистика** (вкладки Last / Month / Overall / Profile). Страница админки в app **удалена** |
| Боковая **Menu Button** (у поля ввода) | **Не** Web App «Статистика». Сброс через API: `resetSideMenuButtonToDefault` при `/start` и **`/fixmenu`** (админ). Если остаётся — в @BotFather: Menu Button → **Default** |
| `/start` | Фото `welcome.jpg` с GitHub Pages + подпись |

Ключевые файлы:

- `worker/src/bot/bottom-menu.ts` — клавиатура, inline для stats, сброс Menu Button
- `worker/src/bot/commands.ts` — `/start`, hears, `/fixmenu`, админ-колбэки
- `worker/src/bot/keyboards.ts` — `adminMenu()` без пункта «Статистика»
- `miniapp/src/App.tsx` — без `?view=admin`
- `miniapp/src/api/client.ts` — `initData` в body + header

История ошибок (чтобы не повторять):

- Reply-клавиатура с `web_app` часто давала **пустой initData** → «нет данных Telegram»
- Раньше в BotFather включали Menu Button с URL Mini App («Статистика») для домена — это **глобальная** кнопка, её нужно сбрасывать отдельно от нижней клавиатуры

### Сделано в сессии 2026-09-26 — 2026-09-27 (кратко)

- Приветствие `/start`: фото `miniapp/public/welcome.jpg` (URL через `WEBAPP_URL`)
- Ввод результатов для игры в статусе **`open`** (не legacy `/newgame` как основной путь)
- Админ **убран из Mini App** (`Admin.tsx` удалён, `?view=admin` убран)
- Нижняя клавиатура: текст-кнопки; Mini App только через **inline** после «Статистика»
- Восстановлена **🔧 Админ** внизу → `adminMenu()` в чате (Игроки / Игры)
- Из админ-меню убран пункт «Статистика» (stats только с нижней кнопки)
- **Menu Button** сбоку: `resetSideMenuButtonToDefault` (глобально + чат), команда **`/fixmenu`**
- Demo: `/seeddemo`, кнопка «🧪 Тестовые данные» → `seedDemo` в `queries.ts` (6 игроков, 4 игры)
- Git (примеры): `96733c6`, `04d7ac1`, `8e9d055`; worker deploy `a0521245-40c1-4218-93ea-9ee94afc8e39`

### Статистика Mini App + бот (✅ проверено 2026-09-27)

**Поведение для всех (админ и участник):**

- Mini App грузит **`GET /api/public/stats`** (без initData) — один **общий снимок клуба** для всех.
- Кнопка **📊 Статистика** → текст из БД + inline **«Открыть статистику»**.
- **30 demo-игр** с результатами (`DEMO_FINISHED_GAMES_TARGET`, `/seeddemo`, `/refreshstats`, автопочинка) — до явного `/cleardemo`.

**Ключевые файлы:**

| Что | Где |
|-----|-----|
| Публичный снимок + кэш `stats_snapshot` | `worker/src/db/queries.ts` → `getPublicStatsSnapshot`, `autoRepairStatsIfBroken` |
| API | `worker/src/index.ts` → `/api/public/stats` |
| DO | `worker/src/durable/PokerRoom.ts` |
| Клиент + кэш session/localStorage | `miniapp/src/context/StatsContext.tsx`, `miniapp/src/api/client.ts` |
| Кнопка «Статистика» (repair для всех) | `worker/src/bot/commands.ts` |

**Git / deploy (рабочая точка):** commit `25fa05f`, worker `e812b2ef-8451-40fd-9738-b06566a5d724`.

**Известная поломка (не повторять):** в БД были **завершённые игры без `game_results`** (миграция `DROP games`, или `finishGame` с 0 строк). Симптом: «30 игр, рейтинг 0», пустой Mini App.

**Исправления (держать в голове при доработках):**

1. `finishGame` — **минимум 2** строки в `game_results`, иначе ошибка.
2. `autoRepairStatsIfBroken` — при пустом рейтинге: удалить «пустые» finished-игры, починить даты; если результатов нет — **re-seed 30 demo** (от первого ID из `ADMIN_IDS`).
3. Автопочинка на **`getPublicStatsSnapshot`** и **`getClubStatsSummary`** — **для всех**, не только админ.
4. Не затирать хороший `stats_snapshot` пустым live-ответом (`refreshStatsSnapshot` / `getPublicStatsSnapshot`).
5. Demo-игроки без `telegram_id` — в Overall/Month/Last; **Profile** — игры зарегистрированного (admin может попасть в seed roster).

---

## Бот и логика (готово / частично)

| Функция | Статус |
|---------|--------|
| `/start`, `/help`, `/admin`, `/fixmenu` | ✅ |
| Самoregистрация `/register`, `/profile`, `/setname`, `/leave` | ✅ |
| Аватар из Telegram `/avatar` | ✅ |
| Админ: `/seeddemo` и «🧪 Тестовые данные» — demo-игроки и завершённые игры | ✅ |
| **Анонс игры:** дата, билет, макс. игроков | ✅ |
| RSVP «Участvую» / «Нет», очередь, старт админа → `open` | ✅ |
| **Ввод результатов** для игры в статусе `open` («📝 Ввод результатов» / `prepareOpenGameResults`) | ✅ |
| Старый черновик игры (legacy buy-in/payout без open-игры) | ✅ (legacy, не основной путь) |
| **Правка результатов с согласием >50% игроков игры** | ❌ |
| Шутливые **статусы** по рейтингу | ❌ (отложено) |
| Красивый Mini App (главная, топ-3, аватары) | ❌ |
| BotFather Menu Button как Web App | ❌ **намеренно не используем** (только Default + stats снизу) |

---

## Mini App (готово / частично)

| Функция | Статус |
|---------|--------|
| 4 вкладки, таблицы, график профиля | ✅ |
| Открытие из бота, initData, API | ✅ |
| **Тестовая статистика** (30 demo, public snapshot, участники) | ✅ проверено владельцем 2026-09-27 |
| UI-редизайн, статусы, анонсы в app | ❌ |

---

## Согласованная логика игр

1. **Участники RSVP** — кто сделал `/register` (не demo из `/seeddemo` без `telegram_id`).
2. Админ: дата, билет, макс. игроков → рассылка зарегистрированным.
3. «Участvую» — первые N; закрытие при лимите или **Старт**.
4. После игры админ вносит результаты для **open**-игры — **без** опроса (первый раз).
5. **Позже** правка — только если **>50%** игроков этой игры подтвердили (не реализовано).

---

## Git и деплой (как работаем с Cursor)

- После правок кода ассистент **сам делает commit + push в `main`** (если не просили иначе).
- Worker: `cd poker-rating/worker` → `npm run deploy`
- Mini App: push в `main` с изменениями в `miniapp/**` → GitHub Actions

---

## Безопасность

- Токен **не** в git и чатах.
- Windows: `wrangler secret put BOT_TOKEN` через файл.
- При утечке: BotFather revoke → новый secret → webhook.

---

## Команды (PowerShell)

```powershell
cd "C:\Users\User\Покер бот\poker-rating\worker"
npm run deploy
npx wrangler tail
```

```powershell
cd "C:\Users\User\Покер бот\poker-rating\miniapp"
npm run build
```

---

## Следующие приоритеты

1. Правка результатов + голосование (>50%).
2. Mini App: главная, рейтинг с аватарами, UI-редизайн.
3. E2E: register → announce → RSVP → start → results → Mini App (реальные игры, не только demo).
4. (Позже) статусы-шутки.

Промпт для нового чата: **`PROMPT-NEW-CHAT.md`**
