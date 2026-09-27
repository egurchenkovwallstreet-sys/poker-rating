export interface Env {
  POKER_ROOM: DurableObjectNamespace;
  BOT_TOKEN: string;
  ADMIN_IDS: string;
  WEBAPP_URL: string;
  BOT_USERNAME: string;
}

export interface Player {
  id: number;
  name: string;
  telegram_id: number | null;
  avatar_file_id: string | null;
  created_at: number;
}

export interface Game {
  id: number;
  date: number;
  status: 'draft' | 'finished' | 'announced' | 'registration_full' | 'open';
  created_by: number;
  created_at: number;
  ticket_price: number;
  max_players: number;
}

export interface GameResult {
  id: number;
  game_id: number;
  player_id: number;
  buyin: number;
  payout: number;
  profit: number;
  place: number | null;
}

export interface GameWithResults {
  game: Game;
  results: Array<GameResult & { player_name: string }>;
}

export interface MonthStatRow {
  player_id: number;
  name: string;
  games_count: number;
  total_profit: number;
  best_game: number;
  worst_game: number;
  wins: number;
  winrate: number;
}

export interface OverallStatRow {
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
  player: Player;
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

/** Общий снимок для Mini App — один на клуб, без персональной авторизации. */
export interface PublicStatsSnapshot {
  updatedAt: number;
  club: {
    finishedGames: number;
    playersInRating: number;
    lastGamePlayers: number;
    testDemoGames: number;
  };
  lastGame: GameWithResults | null;
  overall: OverallStatRow[];
  months: string[];
  monthStats: Record<string, MonthStatRow[]>;
  profiles: Record<string, PlayerProfile>;
}

export type DoAction =
  | { action: 'addPlayer'; name: string; telegramId?: number }
  | { action: 'registerPlayer'; name: string; telegramId: number; avatarFileId?: string | null }
  | { action: 'getPlayerByTelegramId'; telegramId: number }
  | { action: 'updatePlayerName'; telegramId: number; name: string }
  | { action: 'removePlayerByTelegramId'; telegramId: number }
  | { action: 'setPlayerAvatar'; telegramId: number; avatarFileId: string | null }
  | { action: 'removePlayer'; name: string }
  | { action: 'listPlayers' }
  | { action: 'createGame'; playerIds: number[]; createdBy: number }
  | { action: 'addResult'; gameId: number; playerId: number; buyin: number; payout: number; place?: number }
  | { action: 'updateResult'; gameId: number; playerId: number; buyin: number; payout: number; place?: number }
  | { action: 'finishGame'; gameId: number }
  | { action: 'deleteGame'; gameId: number }
  | { action: 'getGame'; gameId: number }
  | { action: 'listDraftGames' }
  | { action: 'listFinishedGames'; limit?: number }
  | { action: 'getLastGame' }
  | { action: 'getClubStatsSummary' }
  | { action: 'getStatsDiagnostics' }
  | { action: 'getMonthStats'; month: string }
  | { action: 'getOverall' }
  | { action: 'getStatsBundle'; month: string }
  | { action: 'getPublicStatsSnapshot' }
  | { action: 'refreshStatsSnapshot' }
  | { action: 'repairAndRefreshStats'; createdBy?: number }
  | { action: 'clearDemoGames' }
  | { action: 'getPlayer'; playerId: number }
  | { action: 'getSession'; userId: number }
  | { action: 'setSession'; userId: number; state: string; data: Record<string, unknown> }
  | { action: 'clearSession'; userId: number }
  | { action: 'seedDemo'; createdBy: number }
  | { action: 'createAnnouncedGame'; scheduledDate: number; ticketPrice: number; maxPlayers: number; createdBy: number }
  | { action: 'listRegisteredPlayers' }
  | { action: 'setGameRsvp'; gameId: number; playerId: number; response: 'yes' | 'no' }
  | { action: 'startAnnouncedGame'; gameId: number }
  | { action: 'listAnnouncedGames' }
  | { action: 'getRsvpSummary'; gameId: number }
  | { action: 'getGameById'; gameId: number }
  | { action: 'listRsvpYesPlayers'; gameId: number }
  | { action: 'listRsvpYesWithQueue'; gameId: number }
  | { action: 'getRsvpQueueOrder'; gameId: number; playerId: number }
  | { action: 'saveInviteMessage'; gameId: number; telegramId: number; messageId: number }
  | { action: 'listInviteMessages'; gameId: number }
  | { action: 'listOpenGames' }
  | { action: 'prepareOpenGameResults'; gameId: number };
