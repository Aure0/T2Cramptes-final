import { useCallback, useEffect, useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { resolveApkReleaseInfo } from '../utils/apkReleaseUrl';
import {
  detectInstallPlatform,
  resolveInstallButtonMode,
  type InstallButtonMode,
  type InstallPlatform,
} from '../utils/pwaInstallLogic';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export interface PWAInstallState {
  mode: InstallButtonMode;
  platform: InstallPlatform;
  isInstallable: boolean;
  isInstalled: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  isNativeApp: boolean;
  apkDownloadUrl: string | null;
  releasesPageUrl: string | null;
  install: () => Promise<boolean>;
}

export function usePWAInstall(): PWAInstallState {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [platform, setPlatform] = useState<InstallPlatform>('desktop-browser');
  const [isNativeApp, setIsNativeApp] = useState(false);

  const apkRelease = useMemo(
    () =>
      resolveApkReleaseInfo({
        envApkUrl: import.meta.env.VITE_ANDROID_APK_URL,
        envGithubRepo: import.meta.env.VITE_GITHUB_REPO,
        locationHref: typeof window !== 'undefined' ? window.location.href : null,
      }),
    []
  );

  useEffect(() => {
    const isCapacitorNative = Capacitor.isNativePlatform();
    const capacitorPlatform = Capacitor.getPlatform();
    setIsNativeApp(isCapacitorNative);

    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const updateDetection = () => {
      const detected = detectInstallPlatform({
        userAgent: window.navigator.userAgent || '',
        isStandaloneDisplayMode: mediaQuery.matches,
        navigatorStandalone:
          (window.navigator as unknown as { standalone?: boolean }).standalone === true,
        isCapacitorNative,
        capacitorPlatform,
      });
      setPlatform(detected.platform);
      setIsInstalled(detected.isInstalledApp);
    };

    updateDetection();

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    mediaQuery.addEventListener?.('change', updateDetection);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      mediaQuery.removeEventListener?.('change', updateDetection);
    };
  }, []);

  const install = useCallback(async (): Promise<boolean> => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  }, [deferredPrompt]);

  const mode = resolveInstallButtonMode({
    platform,
    isInstalledApp: isInstalled,
    hasDeferredPrompt: Boolean(deferredPrompt),
    hasApkDownloadUrl: Boolean(apkRelease?.apkDownloadUrl),
  });

  return {
    mode,
    platform,
    isInstallable: Boolean(deferredPrompt),
    isInstalled,
    isIOS: platform === 'ios-safari' || platform === 'capacitor-ios',
    isAndroid: platform === 'android-browser' || platform === 'capacitor-android',
    isNativeApp,
    apkDownloadUrl: apkRelease?.apkDownloadUrl ?? null,
    releasesPageUrl: apkRelease?.releasesPageUrl ?? null,
    install,
  };
}
