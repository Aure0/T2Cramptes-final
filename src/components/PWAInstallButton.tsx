import React from 'react';
import { Download, Smartphone, Terminal, X } from 'lucide-react';
import { useI18n } from '../contexts/I18nContext';
import type { PWAInstallState } from '../hooks/usePWAInstall';
import { ANDROID_APK_ASSET_NAME } from '../utils/apkReleaseUrl';

interface PWAInstallButtonProps {
  installState: PWAInstallState;
  onOpenGuide: () => void;
  variant?: 'header' | 'drawer';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = React.memo(({
  installState,
  onOpenGuide,
  variant = 'header',
}) => {
  const { t } = useI18n();
  const { mode, isIOS, apkDownloadUrl, install } = installState;

  if (mode === 'hidden') {
    return null;
  }

  const isDirectApkLink = mode === 'apk-download' && Boolean(apkDownloadUrl);

  const handleClick = async () => {
    if (mode === 'native-prompt') {
      await install();
      return;
    }
    onOpenGuide();
  };

  const buttonLabel = isDirectApkLink
    ? t('pwa.androidApp')
    : mode === 'native-prompt'
      ? t('pwa.installApp')
      : isIOS
        ? t('pwa.installIosShort')
        : t('pwa.androidApp');

  const buttonAria = isDirectApkLink
    ? t('pwa.downloadApkAria')
    : mode === 'native-prompt'
      ? t('pwa.installAppAria')
      : isIOS
        ? t('pwa.installIosAria')
        : t('pwa.androidAppAria');

  if (variant === 'drawer') {
    if (isDirectApkLink && apkDownloadUrl) {
      return (
        <a
          href={apkDownloadUrl}
          target="_blank"
          rel="noopener noreferrer"
          download={ANDROID_APK_ASSET_NAME}
          data-testid="drawer-install-app-btn"
          data-install-mode="apk-download"
          aria-label={buttonAria}
          className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/40 text-sky-200 text-xs font-medium transition-colors"
        >
          <span className="inline-flex items-center gap-2 min-w-0">
            <Download className="w-4 h-4 text-sky-300 shrink-0" aria-hidden="true" />
            <span className="truncate">{buttonLabel}</span>
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-300 shrink-0">
            {t('pwa.badgeApk')}
          </span>
        </a>
      );
    }

    return (
      <button
        type="button"
        onClick={handleClick}
        data-testid="drawer-install-app-btn"
        data-install-mode={mode}
        aria-label={buttonAria}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/40 text-sky-200 text-xs font-medium transition-colors"
      >
        <span className="inline-flex items-center gap-2 min-w-0">
          {mode === 'native-prompt' ? (
            <Download className="w-4 h-4 text-sky-300 shrink-0" aria-hidden="true" />
          ) : (
            <Smartphone className="w-4 h-4 text-sky-300 shrink-0" aria-hidden="true" />
          )}
          <span className="truncate">{buttonLabel}</span>
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-300 shrink-0">
          {t('pwa.badgeAndroid')}
        </span>
      </button>
    );
  }

  if (isDirectApkLink && apkDownloadUrl) {
    return (
      <a
        href={apkDownloadUrl}
        target="_blank"
        rel="noopener noreferrer"
        download={ANDROID_APK_ASSET_NAME}
        data-testid="header-install-app-btn"
        data-install-mode="apk-download"
        aria-label={buttonAria}
        title={buttonAria}
        className="hidden sm:inline-flex items-center justify-center gap-1.5 h-9 sm:h-auto px-2.5 sm:px-3 sm:py-1.5 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 text-sky-200 hover:text-white border border-sky-500/40 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
      >
        <Download className="w-3.5 h-3.5 text-sky-300 shrink-0" aria-hidden="true" />
        <span className="hidden lg:inline">{buttonLabel}</span>
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      data-testid="header-install-app-btn"
      data-install-mode={mode}
      aria-label={buttonAria}
      title={buttonAria}
      className="hidden sm:inline-flex items-center justify-center gap-1.5 h-9 sm:h-auto px-2.5 sm:px-3 sm:py-1.5 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 text-sky-200 hover:text-white border border-sky-500/40 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
    >
      {mode === 'native-prompt' ? (
        <Download className="w-3.5 h-3.5 text-sky-300 shrink-0" aria-hidden="true" />
      ) : (
        <Smartphone className="w-3.5 h-3.5 text-sky-300 shrink-0" aria-hidden="true" />
      )}
      <span className="hidden lg:inline">{buttonLabel}</span>
    </button>
  );
});

PWAInstallButton.displayName = 'PWAInstallButton';

interface PWAInstallGuideModalProps {
  isOpen: boolean;
  isIOS: boolean;
  apkDownloadUrl?: string | null;
  onClose: () => void;
}

export const PWAInstallGuideModal: React.FC<PWAInstallGuideModalProps> = ({
  isOpen,
  isIOS,
  apkDownloadUrl,
  onClose,
}) => {
  const { t } = useI18n();

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="android-install-modal-title"
      data-testid="android-install-modal"
    >
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 w-full max-w-md max-h-[90dvh] flex flex-col rounded-2xl bg-[#0F1522] border border-slate-700/90 shadow-2xl overflow-hidden text-slate-100">
        {/* Modal Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-800/90 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src="./icon.svg"
              alt={t('app.brand')}
              width={40}
              height={40}
              className="w-10 h-10 rounded-xl ring-1 ring-white/15 shadow-md shrink-0"
            />
            <div className="min-w-0">
              <h2
                id="android-install-modal-title"
                className="font-display text-sm sm:text-base font-bold text-white leading-tight"
              >
                {isIOS ? t('pwa.modalIosTitle') : t('pwa.modalAndroidTitle')}
              </h2>
              <p className="text-xs text-slate-400 leading-snug mt-0.5">
                {t('pwa.modalSubtitle')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('app.close')}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 text-xs sm:text-sm overflow-y-auto transit-scroll">
          {isIOS ? (
            <div className="rounded-xl bg-[#090D16] border border-slate-800 p-4 space-y-2.5">
              <div className="font-semibold text-slate-100">
                {t('pwa.iosStepsHeading')}
              </div>
              <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-300 leading-relaxed">
                <li>{t('pwa.iosStep1')}</li>
                <li>{t('pwa.iosStep2')}</li>
                <li>{t('pwa.iosStep3')}</li>
              </ol>
            </div>
          ) : (
            <>
              {/* Option 1: Direct Native Android APK (GitHub Releases) */}
              <div className="rounded-xl bg-[#090D16] border border-slate-800 p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 font-semibold text-white text-xs sm:text-sm">
                    <Terminal className="w-3.5 h-3.5 text-sky-400 shrink-0" aria-hidden="true" />
                    <span>{t('pwa.androidOption2Title')}</span>
                  </span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">
                    {t('pwa.badgeApk')}
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {t('pwa.androidApkDesc')}
                </p>
                {apkDownloadUrl ? (
                  <a
                    href={apkDownloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    download={ANDROID_APK_ASSET_NAME}
                    className="inline-flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-semibold transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{t('pwa.downloadApk')}</span>
                  </a>
                ) : (
                  <pre className="rounded-lg bg-[#05080F] border border-slate-800/90 px-3 py-2 text-[11px] font-mono-tabular text-sky-300 overflow-x-auto">
                    npm run build:android{'\n'}npx cap open android
                  </pre>
                )}
              </div>

              {/* Option 2: Instant Android PWA Install */}
              <div className="rounded-xl bg-[#090D16] border border-slate-800 p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-white text-xs sm:text-sm">
                    {t('pwa.androidOption1Title')}
                  </span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    {t('pwa.instantBadge')}
                  </span>
                </div>
                <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-300 leading-relaxed">
                  <li>{t('pwa.androidStep1')}</li>
                  <li>{t('pwa.androidStep2')}</li>
                  <li>{t('pwa.androidStep3')}</li>
                </ol>
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 bg-[#090D16]/70 border-t border-slate-800/90 flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white transition-colors"
          >
            {t('app.close')}
          </button>
        </div>
      </div>
    </div>
  );
};
