const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

function readInitDataFromUrl(): string {
  const fromParams = (raw: string): string => {
    if (!raw) return '';
    const body = raw.startsWith('#') ? raw.slice(1) : raw;
    const tg = new URLSearchParams(body).get('tgWebAppData');
    return tg ? decodeURIComponent(tg) : '';
  };
  const hash = fromParams(window.location.hash);
  if (hash) return hash;
  const q = new URLSearchParams(window.location.search).get('tgWebAppData');
  return q ? decodeURIComponent(q) : '';
}

const INIT_DATA_SESSION_KEY = 'poker_rating_tg_init_data';

let cachedInitData = '';
/** initData, с которым уже получили 401 — не использовать снова (WebApp может держать старый). */
const rejectedInitData = new Set<string>();

function writeSessionInitData(data: string): void {
  try {
    sessionStorage.setItem(INIT_DATA_SESSION_KEY, data);
  } catch {
    /* ignore */
  }
}

function clearSessionInitData(): void {
  try {
    sessionStorage.removeItem(INIT_DATA_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

function persistInitData(data: string): void {
  const trimmed = data.trim();
  if (!trimmed || rejectedInitData.has(trimmed)) return;
  cachedInitData = trimmed;
  writeSessionInitData(trimmed);
}

export function clearInitDataCache(): void {
  cachedInitData = '';
  clearSessionInitData();
}

function isUsableInitData(data: string | undefined | null): data is string {
  const t = data?.trim();
  return Boolean(t && !rejectedInitData.has(t));
}

/** При каждом открытии: сначала URL (Telegram кладёт свежий tgWebAppData), потом WebApp.initData. */
function readFreshInitDataSync(): string {
  const fromUrl = readInitDataFromUrl();
  if (isUsableInitData(fromUrl)) {
    persistInitData(fromUrl);
    return fromUrl;
  }

  const tg = (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp;
  const direct = tg?.initData?.trim();
  if (isUsableInitData(direct)) {
    persistInitData(direct);
    return direct;
  }
  return '';
}

function readSessionFallback(): string {
  if (isUsableInitData(cachedInitData)) return cachedInitData;
  try {
    const fromSession = sessionStorage.getItem(INIT_DATA_SESSION_KEY)?.trim();
    if (isUsableInitData(fromSession)) {
      cachedInitData = fromSession;
      return fromSession;
    }
  } catch {
    /* ignore */
  }
  return '';
}

export async function waitForInitData(timeoutMs = 15000): Promise<string> {
  const tg = (window as unknown as { Telegram?: { WebApp?: { ready?: () => void } } }).Telegram?.WebApp;
  tg?.ready?.();

  const immediate = readFreshInitDataSync();
  if (immediate) return immediate;

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const data = readFreshInitDataSync();
    if (data) return data;
    await new Promise((r) => setTimeout(r, 80));
  }

  return readSessionFallback();
}

let refreshInitDataPromise: Promise<string> | null = null;

function rejectInitData(data: string): void {
  const t = data.trim();
  if (!t) return;
  rejectedInitData.add(t);
  if (cachedInitData === t) cachedInitData = '';
  try {
    const stored = sessionStorage.getItem(INIT_DATA_SESSION_KEY)?.trim();
    if (stored === t) clearSessionInitData();
  } catch {
    /* ignore */
  }
}

async function refreshInitDataAfter401(failed: string): Promise<string> {
  if (!refreshInitDataPromise) {
    refreshInitDataPromise = (async () => {
      rejectInitData(failed);
      const fresh = await waitForInitData(15000);
      refreshInitDataPromise = null;
      return fresh;
    })();
  }
  return refreshInitDataPromise;
}

const FETCH_ATTEMPTS = 3;

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchWithInitData(path: string, initData: string): Promise<Response> {
  const pathWithQuery = path.startsWith('/') ? path : `/${path}`;
  let lastError: unknown;
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(400 * attempt);
    try {
      const res = await fetch(`${API_URL}${pathWithQuery}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData }),
        cache: 'no-store',
        mode: 'cors',
      });
      if (res.status === 503 && attempt < FETCH_ATTEMPTS - 1) continue;
      return res;
    } catch (e) {
      lastError = e;
    }
  }
  console.error('fetch failed', path, lastError);
  throw new Error('NETWORK');
}

async function fetchApi<T>(path: string): Promise<T> {
  if (!API_URL) {
    throw new Error('VITE_API_URL');
  }

  let initData = await waitForInitData();
  if (!initData) {
    throw new Error('NO_INIT_DATA');
  }

  let res = await fetchWithInitData(path, initData);

  if (res.status === 401) {
    initData = await refreshInitDataAfter401(initData);
    if (!initData) {
      throw new Error('API_401');
    }
    res = await fetchWithInitData(path, initData);
  }

  if (!res.ok) {
    throw new Error(`API_${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface GameResult {
  id: number;
  game_id: number;
  player_id: number;
  player_name: string;
  buyin: number;
  payout: number;
  profit: number;
  place: number | null;
}

export interface LastGameData {
  game: { id: number; date: number; status: string };
  results: GameResult[];
}

export interface MonthStat {
  player_id: number;
  name: string;
  games_count: number;
  total_profit: number;
  best_game: number;
  worst_game: number;
  wins: number;
  winrate: number;
}

export interface OverallStat {
  player_id: number;
  name: string;
  place: number;
  games_count: number;
  total_profit: number;
  wins: number;
  winrate: number;
  roi: number;
  streak: number;
}

export interface PlayerProfile {
  player: { id: number; name: string };
  games_count: number;
  total_profit: number;
  chart: Array<{ game_id: number; date: number; profit: number; cumulative: number }>;
  history: Array<{
    game_id: number;
    date: number;
    buyin: number;
    payout: number;
    profit: number;
    place: number | null;
  }>;
}

export function apiErrorMessage(code: string): string {
  switch (code) {
    case 'NO_INIT_DATA':
      return 'Нет данных Telegram. Закройте Mini App (×) и снова: 📊 Статистика → «Открыть статистику».';
    case 'VITE_API_URL':
      return 'Mini App не настроен (VITE_API_URL).';
    case 'NETWORK':
      return 'Не удалось достучаться до сервера бота. Подождите 10 сек и нажмите «Повторить» (интернет может быть в порядке).';
    case 'API_503':
      return 'Сервер бота перегружен. Подождите 10 секунд и нажмите «Повторить».';
    case 'API_401':
      return 'Сессия Telegram устарела. Закройте Mini App (×) и откройте снова из бота.';
    case 'API_404':
      return 'Сервер бота устарел — нужен deploy Worker.';
    default:
      return 'Не удалось загрузить данные';
  }
}

export interface MeResponse {
  userId: number;
  isAdmin: boolean;
  club: {
    finishedGames: number;
    playersInRating: number;
    lastGamePlayers: number;
  };
}

export interface BootstrapResponse extends MeResponse {
  month: string;
  lastGame: LastGameData | null;
  overall: OverallStat[];
  monthStats: MonthStat[];
}

export interface PublicStatsSnapshot {
  updatedAt: number;
  club: {
    finishedGames: number;
    playersInRating: number;
    lastGamePlayers: number;
  };
  lastGame: LastGameData | null;
  overall: OverallStat[];
  months: string[];
  monthStats: Record<string, MonthStat[]>;
  profiles: Record<string, PlayerProfile>;
}

const PUBLIC_STATS_ATTEMPTS = 3;

export async function fetchPublicStats(): Promise<PublicStatsSnapshot> {
  if (!API_URL) {
    throw new Error('VITE_API_URL');
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < PUBLIC_STATS_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(400 * attempt);
    try {
      const res = await fetch(`${API_URL}/api/public/stats`, {
        method: 'GET',
        cache: 'default',
        mode: 'cors',
      });
      if (res.status === 503 && attempt < PUBLIC_STATS_ATTEMPTS - 1) continue;
      if (!res.ok) throw new Error(`API_${res.status}`);
      return (await res.json()) as PublicStatsSnapshot;
    } catch (e) {
      lastError = e;
      if (e instanceof Error && e.message.startsWith('API_')) throw e;
    }
  }
  console.error('public stats fetch failed', lastError);
  throw new Error('NETWORK');
}

async function fetchBootstrap(month: string): Promise<BootstrapResponse> {
  try {
    return await fetchApi<BootstrapResponse>(`/api/bootstrap?month=${encodeURIComponent(month)}`);
  } catch (e) {
    const code = e instanceof Error ? e.message : '';
    if (code !== 'API_404') throw e;
    const [me, last, ov, mon] = await Promise.all([
      fetchApi<MeResponse>('/api/me'),
      fetchApi<LastGameData | null>('/api/last-game'),
      fetchApi<{ stats: OverallStat[] }>('/api/overall'),
      fetchApi<{ month: string; stats: MonthStat[] }>(
        `/api/month?month=${encodeURIComponent(month)}`,
      ),
    ]);
    return {
      ...me,
      month: mon.month,
      lastGame: last,
      overall: Array.isArray(ov.stats) ? ov.stats : [],
      monthStats: Array.isArray(mon.stats) ? mon.stats : [],
    };
  }
}

export const api = {
  getPublicStats: fetchPublicStats,
  getBootstrap: fetchBootstrap,
  getMe: () => fetchApi<MeResponse>('/api/me'),
  getLastGame: () => fetchApi<LastGameData | null>('/api/last-game'),
  getMonthStats: (month: string) =>
    fetchApi<{ month: string; stats: MonthStat[] }>(`/api/month?month=${encodeURIComponent(month)}`),
  getOverall: () => fetchApi<{ stats: OverallStat[] }>('/api/overall'),
  getPlayer: (id: number) => fetchApi<PlayerProfile>(`/api/player/${id}`),
};

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function formatProfit(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toLocaleString('ru-RU')}`;
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function profitClass(n: number): string {
  if (n > 0) return 'profit-positive';
  if (n < 0) return 'profit-negative';
  return '';
}
