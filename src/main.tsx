import { Capacitor } from '@capacitor/core';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

// Register PWA Service Worker in web browsers (skip inside native Capacitor WebView)
if (!Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
  registerSW({
    immediate: true,
    onRegisterError(error) {
      console.warn('[T2C PWA] Service worker registration skipped:', error);
    },
  });
}

createRoot(document.getElementById('root')!).render(<App />);
