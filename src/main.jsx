import './i18n/i18n'; // 🟡 Importante: esto debe ir primero
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

if(window.location.pathname==='/daily-production-pdf'){
  import('./production/dailyPdfRenderer').then(({startDailyPdfRenderer})=>startDailyPdfRenderer());
}else{
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
}
