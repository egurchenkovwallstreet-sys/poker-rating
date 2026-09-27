import { useCallback, useEffect, useState } from 'react';
import { api, apiErrorMessage } from './api/client';
import TabBar, { type Tab } from './components/TabBar';
import LastGame from './pages/LastGame';
import MonthStats from './pages/MonthStats';
import Overall from './pages/Overall';
import Player from './pages/Player';

const titles: Record<Tab, string> = {
  last: '🎯 Последняя игра',
  month: '📅 Статистика за месяц',
  overall: '🏆 Общий рейтинг',
  profile: '👤 Профиль игрока',
};

function tabFromUrl(): Tab | null {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab');
  if (tab === 'month' || tab === 'overall' || tab === 'last' || tab === 'profile') return tab;
  return null;
}

export default function App() {
  const [tab, setTab] = useState<Tab>(() => tabFromUrl() || 'last');
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [clubHint, setClubHint] = useState<string | null>(null);

  useEffect(() => {
    const urlTab = tabFromUrl();
    if (urlTab) setTab(urlTab);
  }, []);

  useEffect(() => {
    api
      .getMe()
      .then((me) => {
        if (me.club.finishedGames === 0) {
          setClubHint('В базе нет завершённых игр. Админ: /seeddemo в боте.');
        }
      })
      .catch((e: unknown) => {
        const code = e instanceof Error ? e.message : '';
        setBootError(code ? apiErrorMessage(code) : 'Не удалось подключиться к серверу');
      });
  }, []);

  const handleSelectPlayer = useCallback((id: number) => {
    if (id <= 0) {
      setPlayerId(null);
    } else {
      setPlayerId(id);
      setTab('profile');
    }
  }, []);

  const handleTabChange = useCallback((newTab: Tab) => {
    setTab(newTab);
    if (newTab !== 'profile') {
      setPlayerId(null);
    }
  }, []);

  return (
    <>
      <header className="page-header">{titles[tab]}</header>

      {bootError && (
        <div className="page-content">
          <div className="card text-center text-tg-hint">{bootError}</div>
        </div>
      )}
      {!bootError && clubHint && (
        <div className="page-content pb-0">
          <div className="card text-center text-sm text-tg-hint">{clubHint}</div>
        </div>
      )}

      {tab === 'last' && <LastGame onSelectPlayer={handleSelectPlayer} />}
      {tab === 'month' && <MonthStats onSelectPlayer={handleSelectPlayer} />}
      {tab === 'overall' && <Overall onSelectPlayer={handleSelectPlayer} />}
      {tab === 'profile' && (
        <Player playerId={playerId} onSelectPlayer={handleSelectPlayer} />
      )}

      <TabBar active={tab} onChange={handleTabChange} />
    </>
  );
}
