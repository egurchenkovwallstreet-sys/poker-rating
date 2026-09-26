import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '../api/client';
import ErrorState from '../components/ErrorState';
import Loading from '../components/Loading';

const BOT_USERNAME = import.meta.env.VITE_BOT_USERNAME || 'poker_rating_bot';

const FALLBACK_ADMIN_IDS = (import.meta.env.VITE_ADMIN_IDS || '1026681672,853510383')
  .split(',')
  .map((s: string) => parseInt(s.trim(), 10))
  .filter((n: number) => !Number.isNaN(n));

function telegramUserId(): number | null {
  const tg = (window as unknown as { Telegram?: { WebApp?: { initDataUnsafe?: { user?: { id?: number } } } } })
    .Telegram?.WebApp;
  return tg?.initDataUnsafe?.user?.id ?? null;
}

type TgWebApp = {
  openTelegramLink?: (url: string) => void;
  showAlert?: (message: string, callback?: () => void) => void;
  HapticFeedback?: { impactOccurred: (style: string) => void };
  close?: () => void;
};

function getTg(): TgWebApp | undefined {
  return (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;
}

function openBotStart(payload: string, title: string) {
  const url = `https://t.me/${BOT_USERNAME}?start=${payload}`;
  const tg = getTg();
  tg?.HapticFeedback?.impactOccurred('medium');

  const go = () => {
    if (tg?.openTelegramLink) tg.openTelegramLink(url);
    else window.location.href = url;
  };

  if (tg?.showAlert) {
    tg.showAlert(`«${title}»\n\nОткроется чат с @${BOT_USERNAME} — продолжите там (это нормально).`, go);
  } else {
    go();
  }
}

function openStatsMiniApp() {
  const u = new URL(window.location.href);
  u.searchParams.delete('view');
  window.location.href = u.pathname + u.search + u.hash;
}

const actions = [
  { label: '👤 Игроки', hint: 'Список игроков клуба', start: 'admin_players' },
  { label: '🎮 Игры', hint: 'Анонс, старт, результаты', start: 'admin_games' },
  { label: '📢 Анонс игры', hint: 'Новая игра и рассылка', start: 'admin_announce' },
  { label: '📝 Ввод результатов', hint: 'После игры (open)', start: 'admin_results' },
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
        setError(apiErrorMessage(msg || 'NETWORK'));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} />;
  if (!allowed) return <ErrorState message="Доступ запрещён" />;

  return (
    <div className="page-content pb-24">
      <div className="card mb-4">
        <p className="text-sm text-tg-text leading-relaxed">
          Это <strong>меню-навигация</strong>. Управление игроками и играми пока в <strong>боте</strong> — кнопки
          ниже открывают чат с @poker_rating_bot.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {actions.map((a) => (
          <button
            key={a.start}
            type="button"
            className="w-full rounded-xl bg-tg-button px-4 py-4 text-left text-tg-button-text shadow-sm active:opacity-90"
            onClick={() => openBotStart(a.start, a.label)}
          >
            <span className="block text-base font-semibold">{a.label}</span>
            <span className="mt-1 block text-sm opacity-90">{a.hint} → чат с ботом</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        className="mt-6 w-full rounded-xl bg-tg-secondary px-4 py-3 text-center text-tg-text font-medium border border-white/10 active:opacity-90"
        onClick={openStatsMiniApp}
      >
        📊 Вернуться к статистике
      </button>
    </div>
  );
}
