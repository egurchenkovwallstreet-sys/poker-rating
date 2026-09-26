# Прогресс: Telegram Mini App «Покерный рейтинг»

Дата обновления: 2026-09-26

## Цель

- Бот + API на **Cloudflare Worker**
- Данные в **Durable Object (SQLite)**
- Mini App на **GitHub Pages**
- Админы по Telegram ID (сейчас один: `1026681672`)

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

### wrangler.toml (актуально)

- `ADMIN_IDS = "[1026681672]"`
- `BOT_USERNAME = "poker_rating_bot"`
- `WEBAPP_URL = "https://egurchenkovwallstreet-sys.github.io/poker-rating/"`

---

## Бот и логика (готово / частично)

| Функция | Статус |
|---------|--------|
| `/start`, `/help`, `/admin` | ✅ |
| Самoregистрация `/register`, `/profile`, `/setname`, `/leave` | ✅ |
| Аватар из Telegram `/avatar` | ✅ |
| Админ: `/seeddemo` — тестовые игроки и игры | ✅ |
| **Анонс игры:** дата, билет, макс. игроков (`/announce`, админ-меню) | ✅ |
| Рассылка приглашения **все зарегистрированным** (личка бота) | ✅ |
| Кнопки «Участvую» / «Нет», очередь по порядку нажатия | ✅ |
| Закрытие записи: места заполнены **или** админ «Старт» | ✅ |
| Короткое уведомление всем при записи + **общий** список в приглашении (sync) | ✅ |
| Старый сценарий: черновик игры, ввод buy-in/payout, finish (админ) | ✅ (legacy) |
| **Ввод результатов после «Старт» открытой игры** | ❌ |
| **Правка результатов с согласием >50% игроков игры** | ❌ |
| Шутливые **статусы** по рейтингу | ❌ (идеи в чате, отложено) |
| Красивый Mini App (главная, топ-3, админка в app) | ❌ |
| Menu Button в BotFather | ❌ |

---

## Mini App (готово / частично)

| Функция | Статус |
|---------|--------|
| 4 вкладки, таблицы, график профиля | ✅ |
| Открытие из бота, initData, API | ✅ (после fix + `VITE_API_URL`) |
| UI-редизайн, статусы, анонсы игр в app | ❌ |

---

## Согласованная логика игр (2026-09-26)

1. **Участники** — кто сделал `/start` + `/register` (не demo из `/seeddemo` без telegram_id).
2. Админ создаёт игру: **дата**, **цена билета**, **макс. игроков**; сам никого не выбирает.
3. Всем зарегистрированным — приглашение в **личку бота**.
4. «Участvую» — первые N по времени; запись закрывается при полном наборе или **Старт** админа.
5. После игры админ **первый раз** вносит результаты — **без** опроса.
6. **Позже** правка результатов — только если **>50%** игроков **этой игры** (в таблице результатов) нажали «Подтвердить».

---

## Безопасность

- Токен **не** хранить в git и чатах.
- На Windows для `wrangler secret put BOT_TOKEN` надёжно через файл (см. PROGRESS в истории чата).
- При утечке: BotFather revoke → `npx wrangler secret put BOT_TOKEN` → проверить webhook.

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

Pages деплоится push в `main` (paths `miniapp/**`) или Run workflow **Deploy Mini App**.

---

## Следующие приоритеты

1. Ввод результатов для игры в статусе `open` → `finished`.
2. Запрос на изменение результатов + голосование участников (>50%).
3. Mini App: главная, рейтинг с аватарами, админ-раздел.
4. BotFather Menu Button → Mini App.
5. (Позже) статусы-шутки по рейтингу.
