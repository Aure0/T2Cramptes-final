import React from 'react';
import { WifiOff } from 'lucide-react';
import { useI18n } from '../contexts/I18nContext';

interface OfflineIndicatorProps {
  isOnline: boolean;
}

export const OfflineIndicator: React.FC<OfflineIndicatorProps> = ({ isOnline }) => {
  const { t } = useI18n();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-indicator"
      className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-amber-500/95 border border-amber-400/80 px-3 py-2 text-xs font-semibold text-slate-950 shadow-xl backdrop-blur-sm mb-[env(safe-area-inset-bottom)]"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{t('pwa.offlineCachedBanner')}</span>
    </div>
  );
};
