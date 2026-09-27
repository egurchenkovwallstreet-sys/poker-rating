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
  type PlayerProfile,
  type PublicStatsSnapshot,
} from '../api/client';

type LoadState = 'loading' | 'ready' | 'error';

interface StatsContextValue {
  lastGame: LastGameData | null | undefined;
  overall: OverallStat[] | undefined;
  month: string;
  monthStats: MonthStat[] | undefined;
  availableMonths: string[];
  updatedAt: number | null;
  error: string | null;
  state: LoadState;
  clubFinishedGames: number | null;
  testDemoGames: number;
  setMonth: (month: string) => void;
  reload: () => void;
  getProfile: (playerId: number) => PlayerProfile | undefined;
}

const StatsContext = createContext<StatsContextValue | null>(null);

function monthStatsFor(snapshot: PublicStatsSnapshot, monthKey: string): MonthStat[] {
  const stats = snapshot.monthStats[monthKey];
  return Array.isArray(stats) ? stats : [];
}

export function StatsProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<PublicStatsSnapshot | null>(null);
  const [month, setMonthState] = useState(currentMonth());
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const loadSeq = useRef(0);
  const hasLoaded = useRef(false);

  const applySnapshot = useCallback((data: PublicStatsSnapshot) => {
    setSnapshot(data);
    const defaultMonth =
      data.months.includes(currentMonth()) ? currentMonth() : data.months[0] ?? currentMonth();
    setMonthState(defaultMonth);
  }, []);

  const loadAll = useCallback(async () => {
    const seq = ++loadSeq.current;
    setError(null);
    if (!hasLoaded.current) setState('loading');

    try {
      const data = await api.getPublicStats();
      if (seq !== loadSeq.current) return;
      applySnapshot(data);
      hasLoaded.current = true;
      setState('ready');
    } catch (e: unknown) {
      if (seq !== loadSeq.current) return;
      const code = e instanceof Error ? e.message : '';
      setError(code ? apiErrorMessage(code) : 'Не удалось загрузить данные');
      if (!hasLoaded.current) setState('error');
    }
  }, [applySnapshot]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const setMonth = useCallback((m: string) => {
    setMonthState(m);
  }, []);

  const reload = useCallback(() => {
    loadAll();
  }, [loadAll]);

  const getProfile = useCallback(
    (playerId: number) => snapshot?.profiles[String(playerId)],
    [snapshot],
  );

  const value = useMemo((): StatsContextValue => {
    const lastGame = snapshot?.lastGame as LastGameData | null | undefined;
    const overall = snapshot?.overall;
    const monthStats = snapshot ? monthStatsFor(snapshot, month) : undefined;
    return {
      lastGame,
      overall,
      month,
      monthStats,
      availableMonths: snapshot?.months ?? [],
      updatedAt: snapshot?.updatedAt ?? null,
      error,
      state,
      clubFinishedGames: snapshot?.club.finishedGames ?? null,
      testDemoGames: snapshot?.club.testDemoGames ?? 0,
      setMonth,
      reload,
      getProfile,
    };
  }, [snapshot, month, error, state, setMonth, reload, getProfile]);

  return <StatsContext.Provider value={value}>{children}</StatsContext.Provider>;
}

export function useStats(): StatsContextValue {
  const ctx = useContext(StatsContext);
  if (!ctx) throw new Error('useStats outside StatsProvider');
  return ctx;
}
