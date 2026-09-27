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

const SNAPSHOT_CACHE_KEY = 'poker_rating_public_stats_v2';

function readSnapshotCache(): PublicStatsSnapshot | null {
  const tryParse = (raw: string | null): PublicStatsSnapshot | null => {
    if (!raw) return null;
    try {
      const data = JSON.parse(raw) as PublicStatsSnapshot;
      if (!Array.isArray(data.overall) || data.overall.length === 0) return null;
      return data;
    } catch {
      return null;
    }
  };
  try {
    return tryParse(sessionStorage.getItem(SNAPSHOT_CACHE_KEY)) ?? tryParse(localStorage.getItem(SNAPSHOT_CACHE_KEY));
  } catch {
    return null;
  }
}

function writeSnapshotCache(data: PublicStatsSnapshot): void {
  if (!Array.isArray(data.overall) || data.overall.length === 0) return;
  const raw = JSON.stringify(data);
  try {
    sessionStorage.setItem(SNAPSHOT_CACHE_KEY, raw);
    localStorage.setItem(SNAPSHOT_CACHE_KEY, raw);
  } catch {
    /* ignore */
  }
}

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

function applySnapshotToState(
  data: PublicStatsSnapshot,
  setSnapshot: (d: PublicStatsSnapshot) => void,
  setMonthState: (m: string) => void,
): void {
  setSnapshot(data);
  const defaultMonth =
    data.months.includes(currentMonth()) ? currentMonth() : data.months[0] ?? currentMonth();
  setMonthState(defaultMonth);
}

export function StatsProvider({ children }: { children: ReactNode }) {
  const initialCacheRef = useRef(readSnapshotCache());
  const initialCache = initialCacheRef.current;
  const [snapshot, setSnapshot] = useState<PublicStatsSnapshot | null>(initialCache);
  const [month, setMonthState] = useState(() => {
    if (initialCache?.months.includes(currentMonth())) return currentMonth();
    return initialCache?.months[0] ?? currentMonth();
  });
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>(initialCache ? 'ready' : 'loading');
  const loadSeq = useRef(0);
  const snapshotRef = useRef<PublicStatsSnapshot | null>(initialCache);

  const loadAll = useCallback(async (background = false) => {
    const seq = ++loadSeq.current;
    setError(null);
    if (!background && !snapshotRef.current) setState('loading');

    try {
      const data = await api.getPublicStats();
      if (seq !== loadSeq.current) return;
      if (!Array.isArray(data.overall) || data.overall.length === 0) {
        if (snapshotRef.current) {
          setState('ready');
          return;
        }
        throw new Error('API_EMPTY');
      }
      applySnapshotToState(data, setSnapshot, setMonthState);
      snapshotRef.current = data;
      writeSnapshotCache(data);
      setState('ready');
    } catch (e: unknown) {
      if (seq !== loadSeq.current) return;
      const code = e instanceof Error ? e.message : '';
      if (snapshotRef.current) {
        setError(
          code === 'API_EMPTY'
            ? 'Сервер отдал пусто — показана сохранённая статистика.'
            : 'Не удалось обновить — показана сохранённая статистика.',
        );
        setState('ready');
        return;
      }
      setError(code === 'API_EMPTY' ? 'Статистика пуста. Админ: /refreshstats в боте.' : apiErrorMessage(code));
      setState('error');
    }
  }, []);

  useEffect(() => {
    loadAll(Boolean(initialCacheRef.current));
  }, [loadAll]);

  const setMonth = useCallback((m: string) => {
    setMonthState(m);
  }, []);

  const reload = useCallback(() => {
    loadAll(false);
  }, [loadAll]);

  const getProfile = useCallback(
    (playerId: number) => {
      const fromSnap = snapshot?.profiles[String(playerId)];
      if (fromSnap) return fromSnap;
      const row = snapshot?.overall?.find((p) => p.player_id === playerId);
      if (!row) return undefined;
      return {
        player: { id: row.player_id, name: row.name },
        games_count: row.games_count,
        total_profit: row.total_profit,
        chart: [],
        history: [],
      };
    },
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
