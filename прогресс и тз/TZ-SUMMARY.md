# Краткое ТЗ (выжимка)

Проект: **Telegram Mini App «Покерный рейтинг»** — статистика покера для одного клуба.

## Принципы

- Данные только в **Cloudflare Durable Objects** (SQLite), не Google Sheets / не VPS
- **Mini App** — React на **GitHub Pages**
- Управление данными — **только через бота** (админы)
- Обычные пользователи — только просмотр в Mini App
- Без Vercel, Firebase, Supabase; работа из РФ без VPN
- API < 200 ms

## Стек

- Worker: TypeScript, Hono, grammY, DO
- Mini App: React 18, Vite, Tailwind, @telegram-apps/sdk-react, recharts

## Роли

- **Админы (2):** ID в `ADMIN_IDS`, команды /admin, игроки, игры
- **Пользователь:** только Mini App

## Критерии готовности (чеклист)

- [ ] Бот отвечает на команды
- [ ] Админ добавляет игрока, создаёт игру, profit sum = 0 при finish
- [ ] Mini App из бота, 4 экрана
- [ ] Деплой Worker + Pages автоматизирован
- [ ] Работает без VPN

Полное ТЗ — в истории первого чата разработки.
