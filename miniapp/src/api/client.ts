import { retrieveLaunchParams } from '@telegram-apps/sdk-react';

const API_URL = import.meta.env.VITE_API_URL || '';

function getInitData(): string {
  try {
    const { initDataRaw } = retrieveLaunchParams();
    return initDataRaw || '';
  } catch {
    return '';
  }
}

async function fetchApi<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: {
      'X-Telegram-Init-Data': getInitData(),
    },
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
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

export const api = {
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
