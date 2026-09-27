import { useEffect, useState } from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';
import { formatDate, formatProfit, profitClass, type PlayerProfile } from '../api/client';

type ChartPoint = PlayerProfile['chart'][number];

function ProfileChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-white/10 bg-[var(--tg-theme-bg-color,#1c1c1e)] px-3 py-2 text-xs shadow-lg">
      <div className="font-medium mb-1">{formatDate(row.date)}</div>
      <div className={profitClass(row.profit)}>
        Результат игры: {formatProfit(row.profit)}
      </div>
      <div className={`mt-0.5 ${profitClass(row.cumulative)}`}>
        Накопительно: {formatProfit(row.cumulative)}
      </div>
    </div>
  );
}
import { useStats } from '../context/StatsContext';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';
import PlayerName from '../components/PlayerName';

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
      setError('Профиль не найден в снимке. Нажмите «Повторить» или откройте Mini App позже.');
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
    if (stats.length === 0) {
      return (
        <div className="page-content">
          <div className="card text-center text-tg-hint">Список игроков пуст</div>
        </div>
      );
    }
    return (
      <div className="page-content">
        <div className="text-sm text-tg-hint mb-3 px-1">Выберите игрока:</div>
        {stats.map((s) => (
          <div
            key={s.player_id}
            className="card mb-2 flex justify-between items-center py-2.5 px-3"
          >
            <PlayerName name={s.name} playerId={s.player_id} onSelect={onSelectPlayer} />
            <span className={`text-sm font-medium ${profitClass(s.total_profit)}`}>
              {formatProfit(s.total_profit)}
            </span>
          </div>
        ))}
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
          <div className="text-sm text-tg-hint mb-2">
            Столбцы — выигрыш/проигрыш в дату игры; линия — накопительный итог
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={profile.chart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <XAxis
                dataKey="date"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(v) =>
                  new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
                }
                tick={{ fontSize: 10 }}
              />
              <YAxis tick={{ fontSize: 10 }} width={40} />
              <Tooltip content={<ProfileChartTooltip />} />
              <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />
              <Bar dataKey="profit" barSize={8} radius={[2, 2, 0, 0]}>
                {profile.chart.map((entry) => (
                  <Cell
                    key={entry.game_id}
                    fill={entry.profit >= 0 ? 'rgba(34, 197, 94, 0.85)' : 'rgba(239, 68, 68, 0.85)'}
                  />
                ))}
              </Bar>
              <Line
                type="stepAfter"
                dataKey="cumulative"
                stroke="var(--tg-theme-button-color, #3390ec)"
                strokeWidth={2}
                dot={{ r: 2 }}
                activeDot={{ r: 4 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="card">
        <div className="text-sm text-tg-hint mb-2">
          История игр
          {profile.history.length > 0 && profile.history.length === profile.games_count
            ? ` (${profile.games_count})`
            : profile.history.length > 0
              ? ` (показано ${profile.history.length} из ${profile.games_count})`
              : ''}
        </div>
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
        ← К списку игроков
      </button>
    </div>
  );
}
