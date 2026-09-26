import { useEffect, useState } from 'react';
import { api, formatDate, formatProfit, profitClass, type LastGameData } from '../api/client';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';
import PlayerName from '../components/PlayerName';

interface Props {
  onSelectPlayer: (id: number) => void;
}

export default function LastGame({ onSelectPlayer }: Props) {
  const [data, setData] = useState<LastGameData | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    setData(undefined);
    api
      .getLastGame()
      .then(setData)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'Не удалось загрузить данные'),
      );
  };

  useEffect(load, []);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (data === undefined) return <Loading />;

  if (!data) {
    return (
      <div className="page-content">
        <div className="card text-center text-tg-hint">Завершённых игр пока нет</div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="card">
        <div className="text-sm text-tg-hint mb-3">📅 {formatDate(data.game.date)}</div>
        <div className="text-xs text-tg-hint grid grid-cols-[24px_1fr_48px_48px_56px] gap-1 mb-2 px-1">
          <span>#</span>
          <span>Игрок</span>
          <span className="text-right">Бай-ин</span>
          <span className="text-right">Стек</span>
          <span className="text-right">+/−</span>
        </div>
        {data.results.map((r) => (
          <div
            key={r.id}
            className="grid grid-cols-[24px_1fr_48px_48px_56px] gap-1 py-2 border-b border-white/10 last:border-0 items-center text-sm"
          >
            <span className="text-tg-hint">{r.place ?? '—'}</span>
            <PlayerName name={r.player_name} playerId={r.player_id} onSelect={onSelectPlayer} />
            <span className="text-right text-tg-hint">{r.buyin}</span>
            <span className="text-right text-tg-hint">{r.payout}</span>
            <span className={`text-right font-medium ${profitClass(r.profit)}`}>
              {formatProfit(r.profit)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
