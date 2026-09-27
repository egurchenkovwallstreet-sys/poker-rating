import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  api,
  apiErrorMessage,
  currentMonth,
  type LastGameData,
  type MonthStat,
  type OverallStat,
} from '../api/client';

type LoadState = 'loading' | 'ready' | 'error';

interface StatsContextValue {
  lastGame: LastGameData | null | undefined;
  overall: OverallStat[] | undefined;
  month: string;
  monthStats: MonthStat[] | undefined;
  error: string | null;
  state: LoadState;
  clubFinishedGames: number | null;
  setMonth: (month: string) => void;
  reload: () => void;
}

const StatsContext = createContext<StatsContextValue | null>(null);

export function StatsProvider({ children }: { children: ReactNode }) {
  const [lastGame, setLastGame] = useState<LastGameData | null | undefined>(undefined);
  const [overall, setOverall] = useState<OverallStat[] | undefined>(undefined);
  const [month, setMonthState] = useState(currentMonth());
  const [monthStats, setMonthStats] = useState<MonthStat[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [clubFinishedGames, setClubFinishedGames] = useState<number | null>(null);
  const loadSeq = useRef(0);
  const monthSeq = useRef(0);
  const hasSuccessfulLoad = useRef(false);

  const loadMonth = useCallback(async (m: string) => {
    const seq = ++monthSeq.current;
    const mon = await api.getMonthStats(m);
    if (seq !== monthSeq.current) return;
    setMonthStats(Array.isArray(mon.stats) ? mon.stats : []);
  }, []);

  const loadAll = useCallback(
    async (monthKey: string) => {
      const seq = ++loadSeq.current;
      setError(null);
      if (!hasSuccessfulLoad.current) {
        setState('loading');
      }

      try {
        const me = await api.getMe();
        if (seq !== loadSeq.current) return;
        setClubFinishedGames(me.club.finishedGames);

        const last = await api.getLastGame();
        if (seq !== loadSeq.current) return;
        setLastGame(last);

        const ov = await api.getOverall();
        if (seq !== loadSeq.current) return;
        const stats = Array.isArray(ov.stats) ? ov.stats : [];
        setOverall(stats);

        if (
          me.club.finishedGames > 0 &&
          stats.length === 0 &&
          me.club.playersInRating > 0
        ) {
          throw new Error('API_EMPTY_STATS');
        }

        await loadMonth(monthKey);
        if (seq !== loadSeq.current) return;
        hasSuccessfulLoad.current = true;
        setState('ready');
      } catch (e: unknown) {
        if (seq !== loadSeq.current) return;
        const code = e instanceof Error ? e.message : '';
        const msg =
          code === 'API_EMPTY_STATS'
            ? 'Данные не загрузились (авторизация). Закройте Mini App (×) и откройте снова из бота.'
            : code
              ? apiErrorMessage(code)
              : 'Не удалось загрузить данные';
        setError(msg);
        if (!hasSuccessfulLoad.current) {
          setState('error');
        }
      }
    },
    [loadMonth],
  );

  useEffect(() => {
    loadAll(currentMonth());
  }, [loadAll]);

  const setMonth = useCallback(
    (m: string) => {
      setMonthState(m);
      loadMonth(m).catch((e: unknown) => {
        const code = e instanceof Error ? e.message : '';
        setError(code ? apiErrorMessage(code) : 'Не удалось загрузить месяц');
      });
    },
    [loadMonth],
  );

  const reload = useCallback(() => {
    loadAll(month);
  }, [loadAll, month]);

  const value = useMemo(
    () => ({
      lastGame,
      overall,
      month,
      monthStats,
      error,
      state,
      clubFinishedGames,
      setMonth,
      reload,
    }),
    [lastGame, overall, month, monthStats, error, state, clubFinishedGames, setMonth, reload],
  );

  return <StatsContext.Provider value={value}>{children}</StatsContext.Provider>;
}

export function useStats(): StatsContextValue {
  const ctx = useContext(StatsContext);
  if (!ctx) throw new Error('useStats outside StatsProvider');
  return ctx;
}
