import { useEffect, useState } from 'react';
import { api } from '../api/client';
import ErrorState from '../components/ErrorState';
import Loading from '../components/Loading';

const BOT_USERNAME = import.meta.env.VITE_BOT_USERNAME || 'poker_rating_bot';

/** Дублирует ADMIN_IDS с Worker (запасная проверка, если /api/me недоступен) */
const FALLBACK_ADMIN_IDS = (import.meta.env.VITE_ADMIN_IDS || '1026681672,853510383')
  .split(',')
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => !Number.isNaN(n));

function telegramUserId(): number | null {
  const tg = (window as unknown as { Telegram?: { WebApp?: { initDataUnsafe?: { user?: { id?: number } } } } })
    .Telegram?.WebApp;
  return tg?.initDataUnsafe?.user?.id ?? null;
}

function openBotStart(payload: string) {
  const url = `https://t.me/${BOT_USERNAME}?start=${payload}`;
  const tg = (window as unknown as { Telegram?: { WebApp?: { openTelegramLink?: (u: string) => void } } })
    .Telegram?.WebApp;
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.location.href = url;
}

const actions = [
  { label: '👤 Игроки', start: 'admin_players' },
  { label: '🎮 Игры', start: 'admin_games' },
  { label: '📢 Анонс игры', start: 'admin_announce' },
  { label: '📝 Ввод результатов', start: 'admin_results' },
] as const;

export default function Admin() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const me = await api.getMe();
        if (!me.isAdmin) setError('Доступ только для администратора');
        else setAllowed(true);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : '';
        const uid = telegramUserId();
        if (uid && FALLBACK_ADMIN_IDS.includes(uid)) {
          setAllowed(true);
          return;
        }
        if (msg === 'NO_INIT_DATA') {
          setError('Откройте «Админ» из кнопки внизу в чате с ботом (не из браузера).');
        } else if (msg === 'API error: 401') {
          setError('Сессия Telegram устарела. Закройте Mini App и снова нажмите «Админ».');
        } else if (msg === 'API error: 404') {
          setError('Сервер бота устарел. Админу нужен deploy Worker (npm run deploy).');
        } else if (msg.includes('VITE_API_URL')) {
          setError('Mini App не знает адрес API. Проверьте VITE_API_URL в GitHub Variables.');
        } else {
          setError(`Не удалось проверить доступ (${msg || 'сеть'})`);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} />;
  if (!allowed) return <ErrorState message="Доступ запрещён" />;

  return (
    <div className="space-y-4 px-4 pb-24 pt-2">
      <p className="text-sm text-gray-400">
        Действия откроются в чате с ботом — там же анонсы, старт игры и результаты.
      </p>
      <div className="flex flex-col gap-2">
        {actions.map((a) => (
          <button
            key={a.start}
            type="button"
            className="rounded-xl bg-gray-800 px-4 py-3 text-left text-base font-medium active:bg-gray-700"
            onClick={() => openBotStart(a.start)}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
