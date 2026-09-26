import React from 'react';
import ReactDOM from 'react-dom/client';
import { init } from '@telegram-apps/sdk-react';
import App from './App';
import './styles/index.css';

try {
  init();
  const tg = (window as unknown as { Telegram?: { WebApp?: { ready?: () => void } } }).Telegram?.WebApp;
  tg?.ready?.();
} catch {
  // dev outside Telegram
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
