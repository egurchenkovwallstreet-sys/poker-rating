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
import { api, formatDate, formatProfit, profitClass, type OverallStat, type PlayerProfile } from '../api/client';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';

interface Props {
  playerId: number | null;
  onSelectPlayer: (id: number) => void;
}

export default function Player({ playerId, onSelectPlayer }: Props) {
  const [profile, setProfile] = useState<PlayerProfile | undefined>(undefined);
  const [players, setPlayers] = useState<OverallStat[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (playerId) {
      setError(null);
      setProfile(undefined);
      api
        .getPlayer(playerId)
        .then(setProfile)
        .catch(() => setError('Не удалось загрузить профиль'));
    } else {
      setProfile(undefined);
      setPlayers(undefined);
      api
        .getOverall()
        .then((res) => setPlayers(res.stats))
        .catch(() => setError('Не удалось загрузить список игроков'));
    }
  }, [playerId]);

  if (playerId === null) {
    if (error) {
      return (
        <ErrorState
          message={error}
          onRetry={() => {
            setError(null);
            setPlayers(undefined);
            api.getOverall().then((res) => setPlayers(res.stats)).catch(() => setError('Не удалось загрузить список игроков'));
          }}
        />
      );
    }
    if (players === undefined) return <Loading />;

    return (
      <div className="page-content">
        <p className="text-tg-hint text-sm mb-4">Выберите игрока:</p>
        {players.length === 0 ? (
          <div className="card text-center text-tg-hint">Игроков пока нет</div>
        ) : (
          players.map((p) => (
            <button
              key={p.player_id}
              type="button"
              className="card w-full text-left flex justify-between items-center"
              onClick={() => onSelectPlayer(p.player_id)}
            >
              <span>{p.name}</span>
              <span className={`font-medium ${profitClass(p.total_profit)}`}>
                {formatProfit(p.total_profit)}
              </span>
            </button>
          ))
        )}
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        message={error}
        onRetry={() => {
          setError(null);
          api.getPlayer(playerId).then(setProfile).catch(() => setError('Не удалось загрузить профиль'));
        }}
      />
    );
  }
  if (profile === undefined) return <Loading />;

  const chartData = profile.chart.map((c, i) => ({
    name: i + 1,
    cumulative: c.cumulative,
    date: formatDate(c.date),
  }));

  return (
    <div className="page-content">
      <button
        type="button"
        className="text-tg-link text-sm mb-3"
        onClick={() => onSelectPlayer(0)}
      >
        ← Все игроки
      </button>

      <h2 className="text-xl font-semibold mb-1">{profile.player.name}</h2>

      <div className="stat-grid">
        <div className="stat-box">
          <div className="stat-label">Всего игр</div>
          <div className="stat-value">{profile.games_count}</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Общий +/−</div>
          <div className={`stat-value ${profitClass(profile.total_profit)}`}>
            {formatProfit(profile.total_profit)}
          </div>
        </div>
      </div>

      {chartData.length > 0 && (
        <div className="card mb-4">
          <div className="text-sm text-tg-hint mb-2">Динамика +/−</div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData}>
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#8e8e93' }} />
              <YAxis tick={{ fontSize: 10, fill: '#8e8e93' }} width={40} />
              <Tooltip
                contentStyle={{ background: '#2c2c2e', border: 'none', borderRadius: 8, fontSize: 12 }}
                labelFormatter={(_, payload) =>
                  payload?.[0]?.payload?.date ? String(payload[0].payload.date) : ''
                }
              />
              <ReferenceLine y={0} stroke="#8e8e93" strokeDasharray="3 3" />
              <Line
                type="monotone"
                dataKey="cumulative"
                stroke="#007aff"
                strokeWidth={2}
                dot={{ r: 3, fill: '#007aff' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="text-sm font-medium mb-2">Последние игры</div>
      {profile.history.length === 0 ? (
        <div className="card text-center text-tg-hint">История пуста</div>
      ) : (
        profile.history.map((h) => (
          <div key={h.game_id} className="card">
            <div className="flex justify-between items-center mb-1">
              <span className="text-sm text-tg-hint">{formatDate(h.date)}</span>
              <span className={`font-semibold ${profitClass(h.profit)}`}>
                {formatProfit(h.profit)}
              </span>
            </div>
            <div className="text-xs text-tg-hint">
              Бай-ин: {h.buyin} · Стек: {h.payout}
              {h.place != null && ` · Место: ${h.place}`}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
