import { useCallback, useEffect, useState } from 'react';
import TabBar, { type Tab } from './components/TabBar';
import LastGame from './pages/LastGame';
import MonthStats from './pages/MonthStats';
import Overall from './pages/Overall';
import Admin from './pages/Admin';
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

function isAdminView(): boolean {
  return new URLSearchParams(window.location.search).get('view') === 'admin';
}

export default function App() {
  const [adminView] = useState(() => isAdminView());
  const [tab, setTab] = useState<Tab>(() => tabFromUrl() || 'last');
  const [playerId, setPlayerId] = useState<number | null>(null);

  useEffect(() => {
    const urlTab = tabFromUrl();
    if (urlTab) setTab(urlTab);
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

  if (adminView) {
    return (
      <>
        <header className="page-header">🔧 Админ</header>
        <Admin />
      </>
    );
  }

  return (
    <>
      <header className="page-header">{titles[tab]}</header>

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
