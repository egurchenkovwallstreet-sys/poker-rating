import { useEffect, useState } from 'react';
import { api, currentMonth, formatProfit, profitClass, type MonthStat } from '../api/client';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';
import PlayerName from '../components/PlayerName';

interface Props {
  onSelectPlayer: (id: number) => void;
}

function monthOptions(): string[] {
  const options: string[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    options.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return options;
}

function formatMonthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
}

export default function MonthStats({ onSelectPlayer }: Props) {
  const [month, setMonth] = useState(currentMonth());
  const [stats, setStats] = useState<MonthStat[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = (m: string) => {
    setError(null);
    setStats(undefined);
    api
      .getMonthStats(m)
      .then((res) => setStats(res.stats))
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'Не удалось загрузить данные'),
      );
  };

  useEffect(() => load(month), [month]);

  if (error) return <ErrorState message={error} onRetry={() => load(month)} />;
  if (stats === undefined) return <Loading />;

  return (
    <div className="page-content">
      <select
        className="w-full mb-4 p-3 rounded-xl bg-tg-secondary text-tg-text border-none outline-none"
        value={month}
        onChange={(e) => setMonth(e.target.value)}
      >
        {monthOptions().map((m) => (
          <option key={m} value={m}>
            {formatMonthLabel(m)}
          </option>
        ))}
      </select>

      {stats.length === 0 ? (
        <div className="card text-center text-tg-hint">Нет данных за этот месяц</div>
      ) : (
        stats.map((s) => (
          <div key={s.player_id} className="card">
            <div className="flex justify-between items-start mb-2">
              <PlayerName name={s.name} playerId={s.player_id} onSelect={onSelectPlayer} />
              <span className={`font-semibold ${profitClass(s.total_profit)}`}>
                {formatProfit(s.total_profit)}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-tg-hint">
              <span>Игр: {s.games_count}</span>
              <span>Винрейт: {s.winrate}%</span>
              <span>Лучшая: {formatProfit(s.best_game)}</span>
              <span>Худшая: {formatProfit(s.worst_game)}</span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
