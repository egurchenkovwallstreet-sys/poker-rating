import { useEffect, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { formatDate, formatProfit, profitClass, type PlayerProfile } from '../api/client';
import { useStats } from '../context/StatsContext';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';

interface Props {
  playerId: number | null;
  onSelectPlayer: (id: number) => void;
}

export default function Player({ playerId, onSelectPlayer }: Props) {
  const { overall, state, reload, error: statsError, getProfile } = useStats();
  const [profile, setProfile] = useState<PlayerProfile | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (playerId) {
      setError(null);
      const fromSnapshot = getProfile(playerId);
      if (fromSnapshot) {
        setProfile(fromSnapshot);
        return;
      }
      setProfile(undefined);
      setError('Профиль не найден в снимке. Обновите статистику после следующей игры.');
    } else {
      setProfile(undefined);
      setError(null);
    }
  }, [playerId, getProfile]);

  if (!playerId) {
    const stats = overall ?? [];
    if (state === 'loading' && stats.length === 0) return <Loading />;
    if (statsError && stats.length === 0) {
      return <ErrorState message={statsError} onRetry={reload} />;
    }
    return (
      <div className="page-content">
        <div className="card text-center text-tg-hint">
          Выберите игрока в таблице рейтинга или последней игры
        </div>
      </div>
    );
  }

  if (error && !profile) {
    return <ErrorState message={error} onRetry={reload} />;
  }
  if (!profile) return <Loading />;

  return (
    <div className="page-content">
      <div className="card mb-3">
        <div className="text-lg font-medium mb-1">{profile.player.name}</div>
        <div className="text-sm text-tg-hint">
          Игр: {profile.games_count} · Итого:{' '}
          <span className={profitClass(profile.total_profit)}>{formatProfit(profile.total_profit)}</span>
        </div>
      </div>

      {profile.chart.length > 0 && (
        <div className="card mb-3">
          <div className="text-sm text-tg-hint mb-2">Динамика (кумулятивный +/-)</div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={profile.chart}>
              <XAxis
                dataKey="date"
                tickFormatter={(v) => new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                tick={{ fontSize: 10 }}
              />
              <YAxis tick={{ fontSize: 10 }} width={36} />
              <Tooltip
                labelFormatter={(v) => formatDate(Number(v))}
                formatter={(v: number) => [formatProfit(v), '+/-']}
              />
              <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />
              <Line type="monotone" dataKey="cumulative" stroke="var(--tg-theme-button-color, #3390ec)" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="card">
        <div className="text-sm text-tg-hint mb-2">История игр</div>
        {profile.history.length === 0 ? (
          <div className="text-center text-tg-hint text-sm">Нет игр в окне 2 года</div>
        ) : (
          profile.history.map((h) => (
            <div
              key={h.game_id}
              className="flex justify-between items-center py-2 border-b border-white/10 text-sm last:border-0"
            >
              <span className="text-tg-hint">{formatDate(h.date)}</span>
              <span className={profitClass(h.profit)}>{formatProfit(h.profit)}</span>
            </div>
          ))
        )}
      </div>

      <button
        type="button"
        className="w-full mt-4 py-2 text-sm text-tg-link"
        onClick={() => onSelectPlayer(0)}
      >
        ← К рейтингу
      </button>
    </div>
  );
}
