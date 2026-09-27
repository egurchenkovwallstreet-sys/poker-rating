import { Bot, webhookCallback, type Context } from 'grammy';
import { callDo } from '../db/do-client';
import { isAdmin, parseAdminIds } from '../api/auth';
import type { Env } from '../types';
import {
  ADMIN_BUTTON_TEXT,
  REGISTER_BUTTON_TEXT,
  STATS_BUTTON_TEXT,
  statsInlineKeyboard,
  resetSideMenuButtonToDefault,
  syncUserBottomMenu,
} from './bottom-menu';
import {
  adminMenu,
  gamesSubmenu,
  playersSubmenu,
} from './keyboards';
import {
  deleteGameAction,
  finishGameAction,
  handleGameInput,
  listDraftGamesForAction,
  listOpenGamesForResults,
  showGameSummary,
  startOpenGameResultsEntry,
} from './admin';
import { telegramProfileAvatarFileId } from './avatar';
import {
  handleAnnounceInput,
  handleGameRsvp,
  listAnnouncedForStart,
  sendOpenAnnouncedInvitesToPlayer,
  startAnnounceWizard,
  startGameAction,
} from './announce';

async function getMyPlayer(env: Env, telegramId: number) {
  const res = await callDo<{ ok: boolean; player: { id: number; name: string } | null }>(env, {
    action: 'getPlayerByTelegramId',
    telegramId,
  });
  return res.player;
}

function welcomePhotoUrl(webappUrl: string): string {
  const base = webappUrl.endsWith('/') ? webappUrl : `${webappUrl}/`;
  return `${base}welcome.jpg`;
}

export function createBot(env: Env): Bot {
  const bot = new Bot(env.BOT_TOKEN.trim());
  const admins = parseAdminIds(env.ADMIN_IDS);

  const checkAdmin = (userId: number) => isAdmin(userId, admins);

  async function promptRegistration(ctx: Context): Promise<void> {
    const userId = ctx.from!.id;
    await callDo(env, { action: 'setSession', userId, state: 'await_register_name', data: {} });
    const keyboard = await syncUserBottomMenu(ctx, env, userId);
    await ctx.reply('Как вас подписать в рейтинге? Напишите одним сообщением (имя должно быть уникальным).', {
      reply_markup: keyboard,
    });
  }

  async function sendWelcome(ctx: Context): Promise<void> {
    const userId = ctx.from!.id;
    const player = await getMyPlayer(env, userId);
    const userIsAdmin = checkAdmin(userId);
    let intro: string;
    if (player) {
      const statsHint = `📊 «${STATS_BUTTON_TEXT}» внизу → «Открыть статистику» (Mini App).`;
      intro = userIsAdmin
        ? `👋 Снова здравствуйте, ${player.name}!\n\n${statsHint}\n🔧 «${ADMIN_BUTTON_TEXT}» внизу — управление клубом в этом чате.`
        : `👋 Снова здравствуйте, ${player.name}!\n\n${statsHint}`;
    } else {
      intro =
        '👋 Добро пожаловать в Покерный рейтинг!\n\nНажмите «Регистрация» внизу и введите имя для рейтинга.';
    }
    const keyboard = await syncUserBottomMenu(ctx, env, userId);
    const menu = { reply_markup: keyboard };
    try {
      await ctx.replyWithPhoto(welcomePhotoUrl(env.WEBAPP_URL), { caption: intro, ...menu });
    } catch (e) {
      console.error('welcome photo failed', e);
      await ctx.reply(intro, menu);
    }
  }

  async function handleAdminDeepLink(ctx: Context, payload: string): Promise<boolean> {
    if (!payload.startsWith('admin')) return false;
    const userId = ctx.from!.id;
    if (!checkAdmin(userId)) {
      await ctx.reply('⛔ Доступ запрещён');
      return true;
    }
    await syncUserBottomMenu(ctx, env, userId);
    switch (payload) {
      case 'admin':
      case 'admin_menu':
        await ctx.reply('🔧 Админ-меню', { reply_markup: adminMenu() });
        return true;
      case 'admin_players': {
        const res = await callDo<{ ok: boolean; players: Array<{ name: string }> }>(env, {
          action: 'listPlayers',
        });
        const list = res.players.map((p) => `• ${p.name}`).join('\n') || 'Пусто';
        await ctx.reply(`📋 Игроки:\n${list}`, { reply_markup: playersSubmenu() });
        return true;
      }
      case 'admin_games':
        await ctx.reply('🎮 Управление играми', { reply_markup: gamesSubmenu() });
        return true;
      case 'admin_announce':
        await startAnnounceWizard(ctx, env);
        return true;
      case 'admin_results':
        await listOpenGamesForResults(ctx, env);
        return true;
      default:
        return false;
    }
  }

  bot.command('start', async (ctx) => {
    const payload = ctx.match?.trim();
    if (payload && (await handleAdminDeepLink(ctx, payload))) return;
    await sendWelcome(ctx);
  });

  bot.command('help', async (ctx) => {
    const adminHelp = checkAdmin(ctx.from!.id)
      ? '\n\nАдмин:\n/admin — меню\n/announce — анонс игры\n/results — ввод результатов'
      : '';
    await ctx.reply(
      `📖 Справка\n\n/start — главное меню\n/register — регистрация\n/profile — мой профиль\n/setname — сменить имя\n/avatar — обновить фото из Telegram\n/leave — удалить свой профиль\n\nСтатистика — Mini App.${adminHelp}`,
    );
  });

  bot.command('register', async (ctx) => {
    const existing = await getMyPlayer(env, ctx.from!.id);
    if (existing) {
      await ctx.reply(`Вы уже зарегистрированы как «${existing.name}». Сменить имя: /setname`);
      return;
    }
    await promptRegistration(ctx);
  });

  bot.hears(REGISTER_BUTTON_TEXT, async (ctx) => {
    const existing = await getMyPlayer(env, ctx.from!.id);
    if (existing) {
      await ctx.reply(`Вы уже зарегистрированы как «${existing.name}».`);
      await syncUserBottomMenu(ctx, env, ctx.from!.id);
      return;
    }
    await promptRegistration(ctx);
  });

  bot.hears(STATS_BUTTON_TEXT, async (ctx) => {
    try {
    const player = await getMyPlayer(env, ctx.from!.id);
    if (!player) {
      await ctx.reply('Сначала зарегистрируйтесь — кнопка «Регистрация» внизу.');
      return;
    }
    let summary = await callDo<{
      ok: boolean;
      summary: {
        finishedGames: number;
        finishedGamesInStats: number;
        playersInRating: number;
        lastGamePlayers: number;
      };
    }>(env, { action: 'getClubStatsSummary' });
    let s = summary.summary;
    if (s.finishedGames > 0 && s.playersInRating === 0) {
      const reseedBy = admins[0] ?? ctx.from!.id;
      const repair = await callDo<{
        ok: boolean;
        summary: typeof s;
        orphansRemoved: number;
        reseeded: boolean;
        demoGames: number;
      }>(env, { action: 'repairAndRefreshStats', createdBy: reseedBy });
      s = repair.summary;
    }
    let dbLine =
      s.finishedGames > 0
        ? `В базе: ${s.finishedGames} завершённых игр (в окне 2 года: ${s.finishedGamesInStats}, в рейтинге: ${s.playersInRating} игроков).\nПоследняя игра: ${s.lastGamePlayers} участников.\n\n`
        : '⚠️ В базе пока нет завершённых игр. Админ: /seeddemo или введите результаты игры.\n\n';
    if (s.finishedGames > 0 && s.playersInRating === 0) {
      dbLine =
        `⚠️ В базе ${s.finishedGames} игр, но нет результатов (рейтинг пуст).\n` +
        `Админ: /refreshstats — починит и заново создаст тестовые игры.\n\n`;
    }
    await ctx.reply(`${dbLine}👇 Откройте Mini App:`, {
      reply_markup: statsInlineKeyboard(env.WEBAPP_URL),
    });
    } catch (e) {
      console.error('stats button:', e);
      await ctx.reply('❌ Не удалось загрузить статистику. Админ: /refreshstats');
    }
  });

  bot.hears(ADMIN_BUTTON_TEXT, async (ctx) => {
    if (!checkAdmin(ctx.from!.id)) {
      await ctx.reply('⛔ Эта кнопка только для администратора.');
      return;
    }
    await ctx.reply('🔧 Админ-меню', { reply_markup: adminMenu() });
  });

  bot.command('profile', async (ctx) => {
    const player = await getMyPlayer(env, ctx.from!.id);
    if (!player) {
      await ctx.reply('Вы ещё не зарегистрированы. Нажмите /register');
      return;
    }
    await ctx.reply(`👤 Ваш профиль\n\nИмя: ${player.name}\nID в рейтинге: ${player.id}`);
  });

  bot.command('setname', async (ctx) => {
    const player = await getMyPlayer(env, ctx.from!.id);
    if (!player) {
      await ctx.reply('Сначала /register');
      return;
    }
    await callDo(env, { action: 'setSession', userId: ctx.from!.id, state: 'await_rename', data: {} });
    await ctx.reply('Напишите новое имя (оно должно быть свободным).');
  });

  bot.command('leave', async (ctx) => {
    try {
      await callDo(env, { action: 'removePlayerByTelegramId', telegramId: ctx.from!.id });
      await callDo(env, { action: 'clearSession', userId: ctx.from!.id });
      const keyboard = await syncUserBottomMenu(ctx, env, ctx.from!.id);
      await ctx.reply('Ваш профиль удалён. Нажмите «Регистрация» внизу.', { reply_markup: keyboard });
    } catch (e) {
      await ctx.reply(`❌ ${e}`);
    }
  });

  bot.command('avatar', async (ctx) => {
    const player = await getMyPlayer(env, ctx.from!.id);
    if (!player) {
      await ctx.reply('Сначала /register');
      return;
    }
    try {
      const fileId = await telegramProfileAvatarFileId(ctx.api, ctx.from!.id);
      if (!fileId) {
        await ctx.reply('В Telegram нет фото профиля. Добавьте аватар в настройках Telegram и снова /avatar');
        return;
      }
      await callDo(env, { action: 'setPlayerAvatar', telegramId: ctx.from!.id, avatarFileId: fileId });
      await ctx.reply('✅ Фото профиля сохранено для рейтинга');
    } catch (e) {
      await ctx.reply(`❌ ${e}`);
    }
  });

  bot.command('admin', async (ctx) => {
    if (!checkAdmin(ctx.from!.id)) {
      await ctx.reply('⛔ Доступ запрещён');
      return;
    }
    await ctx.reply('🔧 Админ-меню', { reply_markup: adminMenu() });
  });

  bot.command('fixmenu', async (ctx) => {
    if (!checkAdmin(ctx.from!.id)) {
      await ctx.reply('⛔ Доступ запрещён');
      return;
    }
    await resetSideMenuButtonToDefault(ctx.api, ctx.chat?.id);
    const keyboard = await syncUserBottomMenu(ctx, env, ctx.from!.id);
    await ctx.reply(
      '✅ Боковая Menu Button сброшена (обычное меню Telegram). Статистика — только кнопка «📊 Статистика» внизу.',
      { reply_markup: keyboard },
    );
  });

  async function runSeedDemo(ctx: Context): Promise<void> {
    if (!checkAdmin(ctx.from!.id)) {
      await ctx.reply('⛔ Доступ запрещён');
      return;
    }
    try {
      const res = await callDo<{
        ok: boolean;
        players: number;
        games: number;
        playerNames: string[];
        linkedAdmin: boolean;
        errors: string[];
      }>(env, {
        action: 'seedDemo',
        createdBy: ctx.from!.id,
      });
      const list = res.playerNames.map((n) => `• ${n}`).join('\n');
      const adminLine = res.linkedAdmin
        ? '\n\nВы зарегистрированы — ваш профиль в demo-играх.'
        : '\n\nПодсказка: /register — тогда seed добавит вас в demo-игры для вкладки «Профиль».';
      const errLine =
        res.errors?.length > 0
          ? `\n\n⚠️ Не все игры сохранились:\n${res.errors.slice(0, 3).join('\n')}`
          : '';
      const head =
        res.games > 0
          ? '✅ Тестовые данные добавлены'
          : '❌ Игры не созданы — см. ошибки ниже';
      const summary = await callDo<{
        ok: boolean;
        summary: { finishedGames: number; playersInRating: number; lastGamePlayers: number };
      }>(env, { action: 'getClubStatsSummary' });
      const sum = summary.summary;
      const verifyLine = `\n\n📊 Сейчас в базе: ${sum.finishedGames} игр, рейтинг: ${sum.playersInRating} игроков, последняя: ${sum.lastGamePlayers} чел.`;
      await ctx.reply(
        `${head}\n\nDemo-игроки (рейтинг в таблицах):\n${list}\n\nЗавершённых игр (этот seed): ${res.games}${verifyLine}${errLine}${adminLine}\n\n📊 Статистика → «Открыть статистику».`,
      );
    } catch (e) {
      await ctx.reply(`❌ ${e}`);
    }
  }

  bot.command('seeddemo', runSeedDemo);

  bot.command('cleardemo', async (ctx) => {
    if (!checkAdmin(ctx.from!.id)) return ctx.reply('⛔ Доступ запрещён');
    const res = await callDo<{ ok: boolean; deleted: number }>(env, { action: 'clearDemoGames' });
    await ctx.reply(
      res.deleted > 0
        ? `🗑 Удалено тестовых игр: ${res.deleted}. Рейтинг обновлён — только «боевые» игры.`
        : 'Тестовых игр (is_demo) не найдено.',
    );
  });

  bot.command('refreshstats', async (ctx) => {
    if (!checkAdmin(ctx.from!.id)) return ctx.reply('⛔ Доступ запрещён');
    try {
      await ctx.reply('⏳ Пересчитываю статистику…');
      const res = await callDo<{
        ok: boolean;
        summary: {
          finishedGames: number;
          finishedGamesInStats: number;
          playersInRating: number;
          lastGamePlayers: number;
        };
        orphansRemoved: number;
        reseeded: boolean;
        demoGames: number;
      }>(env, { action: 'repairAndRefreshStats', createdBy: ctx.from!.id });
      const s = res.summary;
      const extra =
        res.orphansRemoved > 0
          ? `\n🧹 Удалено «пустых» игр без результатов: ${res.orphansRemoved}.`
          : '';
      const seedLine = res.reseeded
        ? `\n🧪 Создано тестовых игр с результатами: ${res.demoGames} (цель: 30).`
        : '';
      await ctx.reply(
        `✅ Статистика пересчитана.\n\n` +
          `Игр: ${s.finishedGames}, в окне 2 года: ${s.finishedGamesInStats}\n` +
          `Игроков в рейтинге: ${s.playersInRating}\n` +
          `Последняя игра: ${s.lastGamePlayers} чел.${extra}${seedLine}\n\n` +
          `Mini App покажет ту же таблицу у всех участников.`,
      );
    } catch (e) {
      console.error('refreshstats:', e);
      await ctx.reply(`❌ Ошибка пересчёта: ${e instanceof Error ? e.message : e}`);
    }
  });

  bot.command('statsdebug', async (ctx) => {
    if (!checkAdmin(ctx.from!.id)) return ctx.reply('⛔ Доступ запрещён');
    const res = await callDo<{
      ok: boolean;
      diagnostics: {
        finishedGames: number;
        resultRows: number;
        resultsLinkedToPlayers: number;
        orphanedResults: number;
        gamesInStatsWindow: number;
        minGameDate: number | null;
        maxGameDate: number | null;
        overallPlayers: number;
      };
    }>(env, { action: 'getStatsDiagnostics' });
    const d = res.diagnostics;
    const fmt = (n: number | null) => (n == null ? '—' : new Date(n).toISOString());
    await ctx.reply(
      `🔍 Диагностика статистики\n\n` +
        `Завершённых игр: ${d.finishedGames}\n` +
        `Строк результатов: ${d.resultRows}\n` +
        `С привязкой к игрокам: ${d.resultsLinkedToPlayers}\n` +
        `Без игрока (осиротевшие): ${d.orphanedResults}\n` +
        `Игр в окне 2 года: ${d.gamesInStatsWindow}\n` +
        `Игроков в рейтинге (API): ${d.overallPlayers}\n` +
        `Дата min/max: ${fmt(d.minGameDate)} … ${fmt(d.maxGameDate)}`,
    );
  });

  bot.command('players', async (ctx) => {
    if (!checkAdmin(ctx.from!.id)) return ctx.reply('⛔ Доступ запрещён');
    const res = await callDo<{ ok: boolean; players: Array<{ id: number; name: string }> }>(env, {
      action: 'listPlayers',
    });
    if (res.players.length === 0) {
      await ctx.reply('Список игроков пуст');
      return;
    }
    const list = res.players.map((p, i) => `${i + 1}. ${p.name} (id: ${p.id})`).join('\n');
    await ctx.reply(`📋 Игроки:\n${list}`);
  });

  bot.command('announce', async (ctx) => {
    if (!checkAdmin(ctx.from!.id)) return ctx.reply('⛔ Доступ запрещён');
    await startAnnounceWizard(ctx, env);
  });

  bot.command('rsvpdebug', async (ctx) => {
    if (!checkAdmin(ctx.from!.id)) return ctx.reply('⛔ Доступ запрещён');
    const id = parseInt(ctx.match?.trim() || '', 10);
    if (isNaN(id)) return ctx.reply('Использование: /rsvpdebug <номер игры из 🆔 #…>');
    const res = await callDo<{
      ok: boolean;
      debug: {
        game: { id: number; status: string; max_players: number } | null;
        pkColumns: string[];
        badGameIdUnique: boolean;
        yesCount: number;
        yesRows: Array<{ player_id: number; name: string; created_at: number; queue_order: number | null }>;
        otherAnnouncedWithYes: Array<{ game_id: number; yes_count: number }>;
        tableSql: string | null;
      };
    }>(env, { action: 'getRsvpDebug', gameId: id });
    const d = res.debug;
    if (!d.game) {
      await ctx.reply(`Игра #${id} не найдена.`);
      return;
    }
    const queue =
      d.yesRows.length > 0
        ? d.yesRows
            .map(
              (r, i) =>
                `${i + 1}. ${r.name} (player_id ${r.player_id}, created ${new Date(r.created_at).toISOString()})`,
            )
            .join('\n')
        : '(пусто)';
    const others =
      d.otherAnnouncedWithYes.length > 0
        ? d.otherAnnouncedWithYes.map((g) => `#${g.game_id}: ${g.yes_count}`).join(', ')
        : 'нет';
    const ddl = d.tableSql ? d.tableSql.replace(/\s+/g, ' ').slice(0, 120) : '?';
    await ctx.reply(
      `🔍 RSVP debug #${id}\n` +
        `status: ${d.game.status}, max_players: ${d.game.max_players}\n` +
        `PK: [${d.pkColumns.join(', ')}], bad UNIQUE(game_id): ${d.badGameIdUnique ? 'ДА' : 'нет'}\n` +
        `yes на этой игре: ${d.yesCount}\n` +
        `yes на других анонсах: ${others}\n\n` +
        `Очередь:\n${queue}\n\n` +
        `DDL: ${ddl}…`,
    );
  });

  bot.command('results', async (ctx) => {
    if (!checkAdmin(ctx.from!.id)) return ctx.reply('⛔ Доступ запрещён');
    await listOpenGamesForResults(ctx, env);
  });

  bot.command('finishgame', async (ctx) => {
    if (!checkAdmin(ctx.from!.id)) return ctx.reply('⛔ Доступ запрещён');
    const id = parseInt(ctx.match?.trim() || '', 10);
    if (isNaN(id)) return ctx.reply('Использование: /finishgame <id>');
    try {
      await callDo(env, { action: 'finishGame', gameId: id });
      await ctx.reply(`✅ Игра #${id} завершена`);
    } catch (e) {
      await ctx.reply(`❌ ${e}`);
    }
  });

  bot.command('deletegame', async (ctx) => {
    if (!checkAdmin(ctx.from!.id)) return ctx.reply('⛔ Доступ запрещён');
    const id = parseInt(ctx.match?.trim() || '', 10);
    if (isNaN(id)) return ctx.reply('Использование: /deletegame <id>');
    try {
      await callDo(env, { action: 'deleteGame', gameId: id });
      await ctx.reply(`✅ Игра #${id} удалена`);
    } catch (e) {
      await ctx.reply(`❌ ${e}`);
    }
  });

  bot.command('editgame', async (ctx) => {
    if (!checkAdmin(ctx.from!.id)) return ctx.reply('⛔ Доступ запрещён');
    const id = parseInt(ctx.match?.trim() || '', 10);
    if (isNaN(id)) {
      await listDraftGamesForAction(ctx, env, 'game:edit', 'Выберите игру для редактирования:');
      return;
    }
    await showGameSummary(ctx, env, id);
  });

  bot.on('message:text', async (ctx) => {
    const userId = ctx.from!.id;
    const sessionRes = await callDo<{ ok: boolean; session: { state: string } | null }>(env, {
      action: 'getSession',
      userId,
    });
    const state = sessionRes.session?.state;

    if (state === 'await_register_name') {
      const name = ctx.message.text.trim();
      await callDo(env, { action: 'clearSession', userId });
      try {
        let avatarFileId: string | null = null;
        try {
          avatarFileId = await telegramProfileAvatarFileId(ctx.api, userId);
        } catch {
          avatarFileId = null;
        }
        const res = await callDo<{ ok: boolean; player: { name: string } }>(env, {
          action: 'registerPlayer',
          name,
          telegramId: userId,
          avatarFileId,
        });
        const keyboard = await syncUserBottomMenu(ctx, env, userId);
        await ctx.reply(`✅ Вы зарегистрированы как «${res.player.name}»`, { reply_markup: keyboard });
        const invites = await sendOpenAnnouncedInvitesToPlayer(ctx.api, env, userId);
        if (invites > 0) {
          await ctx.reply(
            `📢 Отправлено ${invites} анонс(ов) открытых игр. Жмите «Участvую» только в *новом* сообщении с 🆔 номером игры.`,
            { parse_mode: 'Markdown' },
          );
        }
      } catch (e) {
        await ctx.reply(`❌ ${e}\n\nПопробуйте другое имя: /register`);
      }
      return;
    }

    if (state === 'await_rename') {
      const name = ctx.message.text.trim();
      await callDo(env, { action: 'clearSession', userId });
      try {
        const res = await callDo<{ ok: boolean; player: { name: string } }>(env, {
          action: 'updatePlayerName',
          telegramId: userId,
          name,
        });
        await ctx.reply(`✅ Имя изменено на «${res.player.name}»`);
      } catch (e) {
        await ctx.reply(`❌ ${e}`);
      }
      return;
    }

    if (checkAdmin(userId)) {
      const handled = await handleAnnounceInput(ctx, env, ctx.message.text);
      if (handled) return;
      await handleGameInput(ctx, env, ctx.message.text);
    }
  });

  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from!.id;

    if (data === 'admin:back') {
      if (!checkAdmin(userId)) return;
      await ctx.editMessageText('🔧 Админ-меню', { reply_markup: adminMenu() });
      await ctx.answerCallbackQuery();
      return;
    }

    if (data === 'profile:register') {
      const existing = await getMyPlayer(env, userId);
      if (existing) {
        await ctx.answerCallbackQuery({ text: 'Вы уже зарегистрированы' });
        return;
      }
      await callDo(env, { action: 'setSession', userId, state: 'await_register_name', data: {} });
      await syncUserBottomMenu(ctx, env, userId);
      await ctx.reply(
        'Как вас подписать в рейтинге? Напишите одним сообщением (имя должно быть уникальным).',
      );
      await ctx.answerCallbackQuery();
      return;
    }

    if (data === 'admin:players') {
      if (!checkAdmin(userId)) return;
      await ctx.editMessageText('👤 Игроки клуба', { reply_markup: playersSubmenu() });
      await ctx.answerCallbackQuery();
      return;
    }

    if (data === 'admin:games') {
      if (!checkAdmin(userId)) return;
      await ctx.editMessageText('🎮 Управление играми', { reply_markup: gamesSubmenu() });
      await ctx.answerCallbackQuery();
      return;
    }

    if (data === 'admin:list_players') {
      if (!checkAdmin(userId)) return;
      const res = await callDo<{ ok: boolean; players: Array<{ name: string }> }>(env, {
        action: 'listPlayers',
      });
      const list = res.players.map((p) => `• ${p.name}`).join('\n') || 'Пусто';
      await ctx.editMessageText(`📋 Игроки:\n${list}`, { reply_markup: playersSubmenu() });
      await ctx.answerCallbackQuery();
      return;
    }

    if (data === 'admin:seeddemo') {
      if (!checkAdmin(userId)) return;
      await ctx.answerCallbackQuery({ text: 'Создаю тестовые игры…' });
      await runSeedDemo(ctx);
      return;
    }

    if (data === 'admin:announce_game') {
      if (!checkAdmin(userId)) return;
      await startAnnounceWizard(ctx, env);
      await ctx.answerCallbackQuery();
      return;
    }

    if (data === 'admin:start_game') {
      if (!checkAdmin(userId)) return;
      await listAnnouncedForStart(ctx, env);
      await ctx.answerCallbackQuery();
      return;
    }

    if (data.startsWith('game:rsvp:')) {
      const [, , gameIdStr, answer] = data.split(':');
      await handleGameRsvp(ctx, env, parseInt(gameIdStr, 10), answer === 'yes' ? 'yes' : 'no');
      return;
    }

    if (data.startsWith('game:start:')) {
      if (!checkAdmin(userId)) return;
      await startGameAction(ctx, env, parseInt(data.split(':')[2], 10));
      await ctx.answerCallbackQuery();
      return;
    }

    if (data === 'admin:new_game') {
      if (!checkAdmin(userId)) return;
      await listOpenGamesForResults(ctx, env);
      await ctx.answerCallbackQuery();
      return;
    }

    if (data.startsWith('game:results:')) {
      if (!checkAdmin(userId)) return;
      await startOpenGameResultsEntry(ctx, env, parseInt(data.split(':')[2], 10));
      await ctx.answerCallbackQuery();
      return;
    }

    if (data === 'admin:edit_game') {
      if (!checkAdmin(userId)) return;
      await listDraftGamesForAction(ctx, env, 'game:edit', 'Выберите игру:');
      await ctx.answerCallbackQuery();
      return;
    }

    if (data === 'admin:finish_game') {
      if (!checkAdmin(userId)) return;
      await listDraftGamesForAction(ctx, env, 'game:finish', 'Выберите игру для завершения:');
      await ctx.answerCallbackQuery();
      return;
    }

    if (data === 'admin:delete_game') {
      if (!checkAdmin(userId)) return;
      await listDraftGamesForAction(ctx, env, 'game:delete', 'Выберите игру для удаления:');
      await ctx.answerCallbackQuery();
      return;
    }

    if (data.startsWith('game:finish:')) {
      if (!checkAdmin(userId)) return;
      await finishGameAction(ctx, env, parseInt(data.split(':')[2], 10));
      await ctx.answerCallbackQuery();
      return;
    }

    if (data.startsWith('game:delete:')) {
      if (!checkAdmin(userId)) return;
      await deleteGameAction(ctx, env, parseInt(data.split(':')[2], 10));
      await ctx.answerCallbackQuery();
      return;
    }

    if (data.startsWith('game:edit:')) {
      if (!checkAdmin(userId)) return;
      const gameId = parseInt(data.split(':')[2], 10);
      await showGameSummary(ctx, env, gameId);
      await ctx.answerCallbackQuery();
      return;
    }
  });

  bot.catch((err) => {
    console.error('bot error:', err);
  });

  return bot;
}

let webhookHandler: ((request: Request) => Promise<Response>) | null = null;
let webhookToken = '';

export function createWebhookHandler(env: Env) {
  const token = env.BOT_TOKEN.trim();
  if (!webhookHandler || webhookToken !== token) {
    webhookToken = token;
    webhookHandler = webhookCallback(createBot(env), 'cloudflare-mod');
  }
  return webhookHandler;
}
