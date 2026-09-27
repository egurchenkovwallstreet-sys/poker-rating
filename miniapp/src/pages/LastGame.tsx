import { formatDate, formatProfit, profitClass } from '../api/client';
import { useStats } from '../context/StatsContext';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';
import PlayerName from '../components/PlayerName';

interface Props {
  onSelectPlayer: (id: number) => void;
}

export default function LastGame({ onSelectPlayer }: Props) {
  const { lastGame, error, state, reload } = useStats();

  if (error && lastGame === undefined) {
    return <ErrorState message={error} onRetry={reload} />;
  }
  if (state === 'loading' && lastGame === undefined) return <Loading />;

  if (!lastGame) {
    return (
      <div className="page-content">
        <div className="card text-center text-tg-hint">Завершённых игр пока нет</div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="card">
        <div className="text-sm text-tg-hint mb-3">📅 {formatDate(lastGame.game.date)}</div>
        <div className="text-xs text-tg-hint grid grid-cols-[24px_1fr_48px_48px_56px] gap-1 mb-2 px-1">
          <span>#</span>
          <span>Игрок</span>
          <span className="text-right">Бай-ин</span>
          <span className="text-right">Стек</span>
          <span className="text-right">+/−</span>
        </div>
        {lastGame.results.map((r) => (
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
