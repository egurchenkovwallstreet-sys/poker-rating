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
  const hasSuccessfulLoad = useRef(false);

  const applyBootstrap = useCallback(
    (data: Awaited<ReturnType<typeof api.getBootstrap>>) => {
      setClubFinishedGames(data.club.finishedGames);
      setLastGame(data.lastGame);
      setOverall(Array.isArray(data.overall) ? data.overall : []);
      setMonthStats(Array.isArray(data.monthStats) ? data.monthStats : []);
      setMonthState(data.month);
    },
    [],
  );

  const loadAll = useCallback(
    async (monthKey: string) => {
      const seq = ++loadSeq.current;
      setError(null);
      if (!hasSuccessfulLoad.current) {
        setState('loading');
      }

      try {
        const data = await api.getBootstrap(monthKey);
        if (seq !== loadSeq.current) return;
        applyBootstrap(data);
        hasSuccessfulLoad.current = true;
        setState('ready');
      } catch (e: unknown) {
        if (seq !== loadSeq.current) return;
        const code = e instanceof Error ? e.message : '';
        setError(code ? apiErrorMessage(code) : 'Не удалось загрузить данные');
        if (!hasSuccessfulLoad.current) {
          setState('error');
        }
      }
    },
    [applyBootstrap],
  );

  useEffect(() => {
    loadAll(currentMonth());
  }, [loadAll]);

  const setMonth = useCallback(
    (m: string) => {
      setMonthState(m);
      loadAll(m).catch((e: unknown) => {
        const code = e instanceof Error ? e.message : '';
        setError(code ? apiErrorMessage(code) : 'Не удалось загрузить месяц');
      });
    },
    [loadAll],
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
