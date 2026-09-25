export type Tab = 'last' | 'month' | 'overall' | 'profile';

interface Props {
  active: Tab;
  onChange: (tab: Tab) => void;
}

const tabs: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'last', label: 'Последняя', icon: '🎯' },
  { id: 'month', label: 'Месяц', icon: '📅' },
  { id: 'overall', label: 'Общий', icon: '🏆' },
  { id: 'profile', label: 'Профиль', icon: '👤' },
];

export default function TabBar({ active, onChange }: Props) {
  return (
    <nav className="tab-bar">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`tab-item ${active === t.id ? 'active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          <div className="text-base">{t.icon}</div>
          {t.label}
        </button>
      ))}
    </nav>
  );
}
