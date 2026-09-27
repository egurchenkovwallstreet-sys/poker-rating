import { parseAdminIds } from '../api/auth';
import { SCHEMA_SQL } from '../db/schema';
import * as announce from '../db/game-announce';
import * as db from '../db/queries';
import type { DoAction, Env } from '../types';

export class PokerRoom implements DurableObject {
  private sql: SqlStorage;
  private initialized = false;

  constructor(private state: DurableObjectState, private env: Env) {
    this.sql = state.storage.sql;
  }

  private defaultReseedAdminId(): number | undefined {
    return parseAdminIds(this.env.ADMIN_IDS)[0];
  }

  private async ensureInit(): Promise<void> {
    if (this.initialized) return;
    db.initSchema(this.sql, SCHEMA_SQL);
    this.initialized = true;
  }

  async fetch(request: Request): Promise<Response> {
    await this.ensureInit();
    const body = (await request.json()) as DoAction;

    try {
      switch (body.action) {
        case 'addPlayer': {
          try {
            const player = db.addPlayer(this.sql, body.name, body.telegramId);
            return json({ ok: true, player });
          } catch {
            return json({ ok: false, error: 'Игрок уже существует' }, 400);
          }
        }
        case 'registerPlayer': {
          try {
            const player = db.registerPlayer(this.sql, body.name, body.telegramId, body.avatarFileId);
            return json({ ok: true, player });
          } catch (e) {
            return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 400);
          }
        }
        case 'getPlayerByTelegramId': {
          const player = db.getPlayerByTelegramId(this.sql, body.telegramId);
          return json({ ok: true, player });
        }
        case 'updatePlayerName': {
          try {
            const player = db.updatePlayerName(this.sql, body.telegramId, body.name);
            return json({ ok: true, player });
          } catch (e) {
            return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 400);
          }
        }
        case 'removePlayerByTelegramId': {
          const ok = db.removePlayerByTelegramId(this.sql, body.telegramId);
          return json(ok ? { ok: true } : { ok: false, error: 'Профиль не найден' }, ok ? 200 : 404);
        }
        case 'setPlayerAvatar': {
          try {
            const player = db.setPlayerAvatar(this.sql, body.telegramId, body.avatarFileId);
            return json({ ok: true, player });
          } catch (e) {
            return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 400);
          }
        }
        case 'removePlayer': {
          const ok = db.removePlayer(this.sql, body.name);
          return json(ok ? { ok: true } : { ok: false, error: 'Игрок не найден' }, ok ? 200 : 404);
        }
        case 'listPlayers':
          return json({ ok: true, players: db.listPlayers(this.sql) });
        case 'createGame': {
          const gameId = db.createGame(this.sql, body.playerIds, body.createdBy);
          return json({ ok: true, gameId });
        }
        case 'addResult':
          db.addOrUpdateResult(this.sql, body.gameId, body.playerId, body.buyin, body.payout, body.place);
          return json({ ok: true, total: db.getGameProfitSum(this.sql, body.gameId) });
        case 'updateResult':
          db.addOrUpdateResult(this.sql, body.gameId, body.playerId, body.buyin, body.payout, body.place);
          return json({ ok: true, total: db.getGameProfitSum(this.sql, body.gameId) });
        case 'finishGame': {
          const result = db.finishGame(this.sql, body.gameId);
          if (result.ok) {
            try {
              db.refreshStatsSnapshot(this.sql);
            } catch (e) {
              console.error('refreshStatsSnapshot after finishGame:', e);
            }
          }
          return json(result, result.ok ? 200 : 400);
        }
        case 'deleteGame': {
          const ok = db.deleteGame(this.sql, body.gameId);
          return json(ok ? { ok: true } : { ok: false, error: 'Игра не найдена' }, ok ? 200 : 404);
        }
        case 'getGame': {
          const game = db.getGameWithResults(this.sql, body.gameId);
          return json(game ? { ok: true, ...game } : { ok: false, error: 'Игра не найдена' }, game ? 200 : 404);
        }
        case 'listDraftGames':
          return json({ ok: true, games: db.listDraftGames(this.sql) });
        case 'listFinishedGames':
          return json({ ok: true, games: db.listFinishedGames(this.sql, body.limit) });
        case 'getLastGame': {
          const data = db.getLastGame(this.sql);
          return json({ ok: true, data });
        }
        case 'getClubStatsSummary': {
          db.autoRepairStatsIfBroken(this.sql, this.defaultReseedAdminId());
          return json({ ok: true, summary: db.getClubStatsSummary(this.sql) });
        }
        case 'getStatsDiagnostics':
          return json({ ok: true, diagnostics: db.getStatsDiagnostics(this.sql) });
        case 'getMonthStats':
          return json({ ok: true, stats: db.getMonthStats(this.sql, body.month) });
        case 'getOverall':
          return json({ ok: true, stats: db.getOverall(this.sql) });
        case 'getStatsBundle': {
          const bundle = db.getStatsBundle(this.sql, body.month);
          return json({ ok: true, bundle });
        }
        case 'getPublicStatsSnapshot': {
          const snapshot = db.getPublicStatsSnapshot(this.sql, this.defaultReseedAdminId());
          return json({ ok: true, snapshot });
        }
        case 'refreshStatsSnapshot':
          db.refreshStatsSnapshot(this.sql);
          return json({ ok: true });
        case 'repairAndRefreshStats': {
          const repair = db.repairClubStatsData(this.sql, body.createdBy);
          return json({
            ok: true,
            summary: db.getClubStatsSummary(this.sql),
            orphansRemoved: repair.orphansRemoved,
            reseeded: repair.reseeded,
            demoGames: repair.demoGames,
          });
        }
        case 'clearDemoGames': {
          const deleted = db.clearDemoGames(this.sql);
          return json({ ok: true, deleted });
        }
        case 'getPlayer': {
          const profile = db.getPlayerProfile(this.sql, body.playerId);
          return json(profile ? { ok: true, profile } : { ok: false, error: 'Игрок не найден' }, profile ? 200 : 404);
        }
        case 'getSession': {
          const session = db.getSession(this.sql, body.userId);
          return json({ ok: true, session });
        }
        case 'setSession':
          db.setSession(this.sql, body.userId, body.state, body.data);
          return json({ ok: true });
        case 'clearSession':
          db.clearSession(this.sql, body.userId);
          return json({ ok: true });
        case 'seedDemo': {
          const result = db.seedDemo(this.sql, body.createdBy);
          return json({ ok: true, ...result });
        }
        case 'createAnnouncedGame': {
          try {
            const gameId = announce.createAnnouncedGame(
              this.sql,
              body.scheduledDate,
              body.ticketPrice,
              body.maxPlayers,
              body.createdBy,
            );
            const game = announce.getGameById(this.sql, gameId);
            return json({ ok: true, gameId, game });
          } catch (e) {
            return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 400);
          }
        }
        case 'listRegisteredPlayers':
          return json({ ok: true, players: announce.listRegisteredPlayers(this.sql) });
        case 'setGameRsvp': {
          const result = announce.setGameRsvp(
            this.sql,
            announce.normalizeGameId(body.gameId),
            body.playerId,
            body.response,
          );
          if (!result.ok) return json({ ok: false, error: result.error }, 400);
          return json(result);
        }
        case 'getRsvpQueueOrder': {
          const gameId = announce.normalizeGameId(body.gameId);
          const playerId = announce.normalizeGameId(body.playerId);
          const queueOrder = announce.getRsvpQueueOrder(this.sql, gameId, playerId);
          return json({
            ok: true,
            queueOrder,
            yesCount: announce.countRsvpYes(this.sql, gameId),
          });
        }
        case 'startAnnouncedGame': {
          const result = announce.startAnnouncedGame(this.sql, body.gameId);
          if (!result.ok) return json(result, 400);
          return json({
            ok: true,
            roster: result.roster,
            players: result.roster,
            yesCount: result.yesCount,
            startedGameId: result.startedGameId,
            requestedGameId: result.requestedGameId,
            mergedFromOtherGames: result.mergedFromOtherGames,
          });
        }
        case 'listAnnouncedGames':
          return json({ ok: true, games: announce.listAnnouncedGames(this.sql) });
        case 'listAnnouncedGamesForStart':
          return json({ ok: true, games: announce.listAnnouncedGamesForStart(this.sql) });
        case 'getActiveAnnouncedGame': {
          const active = announce.getActiveAnnouncedGame(this.sql);
          return json(
            active
              ? { ok: true, gameId: active.gameId, game: active.game }
              : { ok: true, gameId: null, game: null },
          );
        }
        case 'listAllInviteMessages':
          return json({ ok: true, messages: announce.listAllInviteMessages(this.sql) });
        case 'getRsvpSummary': {
          const summary = announce.getRsvpSummary(this.sql, body.gameId);
          return json({ ok: true, ...summary });
        }
        case 'getGameById': {
          const game = announce.getGameById(this.sql, body.gameId);
          return json(game ? { ok: true, game } : { ok: false, error: 'Игра не найдена' }, game ? 200 : 404);
        }
        case 'listRsvpYesPlayers':
          return json({ ok: true, players: announce.listRsvpYesPlayers(this.sql, body.gameId) });
        case 'listRsvpYesWithQueue':
          return json({ ok: true, entries: announce.listRsvpYesWithQueue(this.sql, body.gameId) });
        case 'getRsvpDebug':
          return json({ ok: true, debug: announce.getRsvpDebugInfo(this.sql, body.gameId) });
        case 'saveInviteMessage':
          announce.saveInviteMessage(this.sql, body.gameId, body.telegramId, body.messageId);
          return json({ ok: true });
        case 'listInviteMessages':
          return json({ ok: true, messages: announce.listInviteMessages(this.sql, body.gameId) });
        case 'listOpenGames':
          return json({ ok: true, games: announce.listOpenGames(this.sql) });
        case 'prepareOpenGameResults': {
          const result = announce.prepareOpenGameForResults(this.sql, body.gameId);
          return json(result, result.ok ? 200 : 400);
        }
        default:
          return json({ ok: false, error: 'Unknown action' }, 400);
      }
    } catch (e) {
      console.error('DO error:', e);
      return json({ ok: false, error: String(e) }, 500);
    }
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
