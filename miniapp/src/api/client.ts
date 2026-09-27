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

const INIT_DATA_STORAGE_KEY = 'poker_rating_tg_init_data';

function readPersistedInitData(): string {
  try {
    return sessionStorage.getItem(INIT_DATA_STORAGE_KEY)?.trim() || '';
  } catch {
    return '';
  }
}

function writePersistedInitData(data: string): void {
  try {
    sessionStorage.setItem(INIT_DATA_STORAGE_KEY, data);
    localStorage.setItem(INIT_DATA_STORAGE_KEY, data);
  } catch {
    /* ignore */
  }
}

function clearPersistedInitData(): void {
  try {
    sessionStorage.removeItem(INIT_DATA_STORAGE_KEY);
    localStorage.removeItem(INIT_DATA_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** После первого успешного чтения не теряем initData (вкладки, обновление страницы в Telegram). */
let cachedInitData = '';

function persistInitData(data: string): void {
  const trimmed = data.trim();
  if (!trimmed) return;
  cachedInitData = trimmed;
  writePersistedInitData(trimmed);
}

function readStoredInitData(): string {
  if (cachedInitData) return cachedInitData;
  const fromSession = readPersistedInitData();
  if (fromSession) {
    cachedInitData = fromSession;
    return fromSession;
  }
  try {
    const fromLocal = localStorage.getItem(INIT_DATA_STORAGE_KEY)?.trim();
    if (fromLocal) {
      cachedInitData = fromLocal;
      return fromLocal;
    }
  } catch {
    /* ignore */
  }
  return '';
}

function readInitDataSync(): string {
  const tg = (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp;
  const direct = tg?.initData?.trim();
  if (direct) {
    persistInitData(direct);
    return direct;
  }
  const fromUrl = readInitDataFromUrl();
  if (fromUrl) {
    persistInitData(fromUrl);
    return fromUrl;
  }
  return readStoredInitData();
}

/** Telegram иногда отдаёт initData с задержкой после открытия Web App с клавиатуры */
export async function waitForInitData(timeoutMs = 10000): Promise<string> {
  const stored = readStoredInitData();
  if (stored) return stored;

  const tg = (window as unknown as { Telegram?: { WebApp?: { ready?: () => void } } }).Telegram?.WebApp;
  tg?.ready?.();

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const data = readInitDataSync();
    if (data) {
      persistInitData(data);
      return data;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  const fallback = readInitDataSync();
  if (fallback) persistInitData(fallback);
  return fallback;
}

async function fetchApi<T>(path: string): Promise<T> {
  if (!API_URL) {
    throw new Error('VITE_API_URL');
  }
  const initData = await waitForInitData();
  if (!initData) {
    throw new Error('NO_INIT_DATA');
  }

  const pathWithQuery = path.startsWith('/') ? path : `/${path}`;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${pathWithQuery}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Init-Data': initData,
      },
      body: JSON.stringify({ initData }),
    });
  } catch {
    throw new Error('NETWORK');
  }

  if (!res.ok) {
    if (res.status === 401) {
      cachedInitData = '';
      clearPersistedInitData();
    }
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
      return 'Нет данных Telegram. Не обновляйте страницу вручную — закройте Mini App (×) и откройте снова: 📊 Статистика → «Открыть статистику».';
    case 'VITE_API_URL':
      return 'Mini App не настроен (VITE_API_URL).';
    case 'NETWORK':
      return 'Нет связи с сервером. Проверьте интернет.';
    case 'API_401':
      return 'Сессия устарела или неверный BOT_TOKEN на сервере. Закройте Mini App и откройте снова.';
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

export const api = {
  getMe: () => fetchApi<MeResponse>('/api/me'),
  getLastGame: () => fetchApi<LastGameData | null>('/api/last-game'),
  getMonthStats: (month: string) =>
    fetchApi<{ month: string; stats: MonthStat[] }>(`/api/month?month=${month}`),
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
