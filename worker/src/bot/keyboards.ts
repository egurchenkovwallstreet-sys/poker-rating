import { InlineKeyboard } from 'grammy';
import type { Player } from '../types';

export function mainMenu(webappUrl: string, registered: boolean) {
  const kb = new InlineKeyboard().webApp('📊 Открыть статистику', webappUrl);
  if (!registered) {
    kb.row().text('✍️ Зарегистрироваться', 'profile:register');
  }
  return kb;
}

export function adminMenu() {
  return new InlineKeyboard()
    .text('👤 Игроки', 'admin:players')
    .row()
    .text('🎮 Игры', 'admin:games')
    .row()
    .text('📊 Статистика', 'admin:stats');
}

export function playersSubmenu() {
  return new InlineKeyboard()
    .text('📋 Список игроков', 'admin:list_players')
    .row()
    .text('◀️ Назад', 'admin:back');
}

export function gamesSubmenu() {
  return new InlineKeyboard()
    .text('➕ Новая игра', 'admin:new_game')
    .row()
    .text('✏️ Редактировать игру', 'admin:edit_game')
    .row()
    .text('✅ Завершить игру', 'admin:finish_game')
    .row()
    .text('🗑 Удалить игру', 'admin:delete_game')
    .row()
    .text('◀️ Назад', 'admin:back');
}

export function statsSubmenu(webappUrl: string) {
  return new InlineKeyboard()
    .webApp('📅 За месяц', `${webappUrl}?tab=month`)
    .row()
    .webApp('🏆 Общая', `${webappUrl}?tab=overall`)
    .row()
    .text('◀️ Назад', 'admin:back');
}

export function playerSelectionKeyboard(
  players: Player[],
  selected: Set<number>,
  sessionKey: string,
) {
  const kb = new InlineKeyboard();
  for (const p of players) {
    const mark = selected.has(p.id) ? '✅' : '⬜';
    kb.text(`${mark} ${p.name}`, `newgame:toggle:${sessionKey}:${p.id}`).row();
  }
  if (selected.size > 0) {
    kb.text('✔️ Готово', `newgame:done:${sessionKey}`).row();
  }
  kb.text('❌ Отмена', 'newgame:cancel');
  return kb;
}

export function gameSummaryKeyboard(gameId: number) {
  return new InlineKeyboard()
    .text('✅ Завершить игру', `game:finish:${gameId}`)
    .row()
    .text('✏️ Изменить данные', `game:edit:${gameId}`)
    .row()
    .text('🗑 Удалить игру', `game:delete:${gameId}`);
}

export function draftGamesKeyboard(games: Array<{ id: number; created_at: number }>, action: string) {
  const kb = new InlineKeyboard();
  for (const g of games) {
    const date = new Date(g.created_at).toLocaleDateString('ru-RU');
    kb.text(`#${g.id} (${date})`, `${action}:${g.id}`).row();
  }
  kb.text('◀️ Назад', 'admin:games');
  return kb;
}

export function finishedGamesKeyboard(games: Array<{ id: number; date: number }>, action: string) {
  const kb = new InlineKeyboard();
  for (const g of games) {
    const date = new Date(g.date).toLocaleDateString('ru-RU');
    kb.text(`#${g.id} (${date})`, `${action}:${g.id}`).row();
  }
  kb.text('◀️ Назад', 'admin:games');
  return kb;
}
