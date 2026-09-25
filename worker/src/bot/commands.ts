import { Bot, webhookCallback } from 'grammy';
import { callDo } from '../db/do-client';
import { isAdmin, parseAdminIds } from '../api/auth';
import type { Env } from '../types';
import {
  adminMenu,
  gamesSubmenu,
  mainMenu,
  playersSubmenu,
  statsSubmenu,
} from './keyboards';
import {
  deleteGameAction,
  finishGameAction,
  finishPlayerSelection,
  handleGameInput,
  listDraftGamesForAction,
  showGameSummary,
  startNewGame,
  togglePlayer,
} from './admin';
import { telegramProfileAvatarFileId } from './avatar';

async function getMyPlayer(env: Env, telegramId: number) {
  const res = await callDo<{ ok: boolean; player: { id: number; name: string } | null }>(env, {
    action: 'getPlayerByTelegramId',
    telegramId,
  });
  return res.player;
}

export function createBot(env: Env): Bot {
  const bot = new Bot(env.BOT_TOKEN.trim());
  const admins = parseAdminIds(env.ADMIN_IDS);

  const checkAdmin = (userId: number) => isAdmin(userId, admins);

  bot.command('start', async (ctx) => {
    const player = await getMyPlayer(env, ctx.from!.id);
    const intro = player
      ? `👋 Снова здравствуйте, ${player.name}!\n\nСтатистика — в Mini App.`
      : '👋 Добро пожаловать в Покерный рейтинг!\n\nСначала зарегистрируйтесь — придумайте имя для рейтинга.';
    await ctx.reply(intro, { reply_markup: mainMenu(env.WEBAPP_URL, Boolean(player)) });
  });

  bot.command('help', async (ctx) => {
    const adminHelp = checkAdmin(ctx.from!.id)
      ? '\n\nАдмин:\n/admin — меню игр\n/newgame, /finishgame, /deletegame'
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
    await callDo(env, { action: 'setSession', userId: ctx.from!.id, state: 'await_register_name', data: {} });
    await ctx.reply('Как вас подписать в рейтинге? Напишите одним сообщением (имя должно быть уникальным).');
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
      await ctx.reply('Ваш профиль удалён. Чтобы вернуться — /register');
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

  bot.command('newgame', async (ctx) => {
    if (!checkAdmin(ctx.from!.id)) return ctx.reply('⛔ Доступ запрещён');
    await startNewGame(ctx, env);
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
        await ctx.reply(`✅ Вы зарегистрированы как «${res.player.name}»`, {
          reply_markup: mainMenu(env.WEBAPP_URL, true),
        });
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

    if (!checkAdmin(userId)) return;

    await handleGameInput(ctx, env, ctx.message.text);
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
      await ctx.editMessageText(
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

    if (data === 'admin:new_game') {
      if (!checkAdmin(userId)) return;
      await startNewGame(ctx, env);
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

    if (data.startsWith('newgame:toggle:')) {
      if (!checkAdmin(userId)) return;
      const [, , sessionKey, playerIdStr] = data.split(':');
      await togglePlayer(ctx, env, sessionKey, parseInt(playerIdStr, 10));
      await ctx.answerCallbackQuery();
      return;
    }

    if (data.startsWith('newgame:done:')) {
      if (!checkAdmin(userId)) return;
      await finishPlayerSelection(ctx, env);
      return;
    }

    if (data === 'newgame:cancel') {
      if (!checkAdmin(userId)) return;
      await callDo(env, { action: 'clearSession', userId });
      await ctx.editMessageText('❌ Создание игры отменено');
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
