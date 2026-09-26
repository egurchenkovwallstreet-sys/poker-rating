import { useEffect, useState } from 'react';
import { api, formatProfit, profitClass, type OverallStat } from '../api/client';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';
import PlayerName from '../components/PlayerName';

interface Props {
  onSelectPlayer: (id: number) => void;
}

export default function Overall({ onSelectPlayer }: Props) {
  const [stats, setStats] = useState<OverallStat[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    setStats(undefined);
    api
      .getOverall()
      .then((res) => setStats(res.stats))
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'Не удалось загрузить данные'),
      );
  };

  useEffect(load, []);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (stats === undefined) return <Loading />;

  if (stats.length === 0) {
    return (
      <div className="page-content">
        <div className="card text-center text-tg-hint">Рейтинг пуст</div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="text-xs text-tg-hint grid grid-cols-[28px_1fr_40px_56px_40px_40px] gap-1 mb-2 px-1">
        <span>#</span>
        <span>Игрок</span>
        <span className="text-right">Игр</span>
        <span className="text-right">+/−</span>
        <span className="text-right">WR</span>
        <span className="text-right">ROI</span>
      </div>
      {stats.map((s) => (
        <div
          key={s.player_id}
          className="grid grid-cols-[28px_1fr_40px_56px_40px_40px] gap-1 py-2.5 border-b border-white/10 items-center text-sm"
        >
          <span className="text-tg-hint">{s.place}</span>
          <PlayerName name={s.name} playerId={s.player_id} onSelect={onSelectPlayer} />
          <span className="text-right text-tg-hint">{s.games_count}</span>
          <span className={`text-right font-medium ${profitClass(s.total_profit)}`}>
            {formatProfit(s.total_profit)}
          </span>
          <span className="text-right text-tg-hint">{s.winrate}%</span>
          <span className={`text-right ${profitClass(s.roi)}`}>{s.roi}%</span>
        </div>
      ))}
      <div className="text-xs text-tg-hint mt-4 text-center">
        Серия: положительная/отрицательная подряд (последние игры)
      </div>
    </div>
  );
}
