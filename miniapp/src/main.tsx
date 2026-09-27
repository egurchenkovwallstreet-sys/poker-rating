import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/index.css';

const tg = (window as unknown as { Telegram?: { WebApp?: { ready?: () => void; expand?: () => void } } })
  .Telegram?.WebApp;
tg?.ready?.();
tg?.expand?.();

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
