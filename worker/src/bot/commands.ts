import { Bot, webhookCallback, type Context } from 'grammy';
import { callDo } from '../db/do-client';
import { isAdmin, parseAdminIds } from '../api/auth';
import type { Env } from '../types';
import {
  ADMIN_BUTTON_TEXT,
  REGISTER_BUTTON_TEXT,
  STATS_BUTTON_TEXT,
  adminInlineKeyboard,
  statsInlineKeyboard,
  syncUserBottomMenu,
} from './bottom-menu';
import {
  adminMenu,
  gamesSubmenu,
  playersSubmenu,
  statsSubmenu,
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
      intro = userIsAdmin
        ? `👋 Снова здравствуйте, ${player.name}!\n\n📊 Статистика — кнопка «Menu» слева от ввода или «${STATS_BUTTON_TEXT}» внизу → «Открыть» в чате.\n🔧 Админ — «${ADMIN_BUTTON_TEXT}» внизу → «Открыть».`
        : `👋 Снова здравствуйте, ${player.name}!\n\n📊 «Menu» слева от ввода или «${STATS_BUTTON_TEXT}» внизу → «Открыть статистику».`;
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
    const player = await getMyPlayer(env, ctx.from!.id);
    if (!player) {
      await ctx.reply('Сначала зарегистрируйтесь — кнопка «Регистрация» внизу.');
      return;
    }
    await ctx.reply('👇 Нажмите, чтобы открыть Mini App:', {
      reply_markup: statsInlineKeyboard(env.WEBAPP_URL),
    });
  });

  bot.hears(ADMIN_BUTTON_TEXT, async (ctx) => {
    if (!checkAdmin(ctx.from!.id)) {
      await ctx.reply('⛔ Эта кнопка только для администратора.');
      return;
    }
    await ctx.reply('👇 Админ-панель в Mini App:', {
      reply_markup: adminInlineKeyboard(env.WEBAPP_URL),
    });
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
      }>(env, {
        action: 'seedDemo',
        createdBy: ctx.from!.id,
      });
      const list = res.playerNames.map((n) => `• ${n}`).join('\n');
      await ctx.reply(
        `✅ Тестовые данные добавлены\n\nИгроки (без Telegram, только рейтинг):\n${list}\n\nЗавершённых игр: ${res.games}\n\nОткройте «Статистика» внизу или Mini App.`,
      );
    } catch (e) {
      await ctx.reply(`❌ ${e}`);
    }
  }

  bot.command('seeddemo', runSeedDemo);

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

    if (data === 'admin:stats') {
      if (!checkAdmin(userId)) return;
      await ctx.editMessageText('📊 Статистика', { reply_markup: statsSubmenu(env.WEBAPP_URL) });
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
      await runSeedDemo(ctx);
      await ctx.answerCallbackQuery();
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
