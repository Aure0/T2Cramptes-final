export type InstallPlatform =
  | 'capacitor-android'
  | 'capacitor-ios'
  | 'android-browser'
  | 'ios-safari'
  | 'desktop-browser';

export type InstallButtonMode =
  | 'hidden'
  | 'apk-download'
  | 'native-prompt'
  | 'android-guide'
  | 'ios-guide';

export interface PlatformDetectionInput {
  userAgent: string;
  isStandaloneDisplayMode: boolean;
  navigatorStandalone?: boolean;
  isCapacitorNative?: boolean;
  capacitorPlatform?: string;
}

export function detectInstallPlatform(input: PlatformDetectionInput): {
  platform: InstallPlatform;
  isInstalledApp: boolean;
} {
  const ua = (input.userAgent || '').toLowerCase();

  if (input.isCapacitorNative) {
    const capPlatform = (input.capacitorPlatform || '').toLowerCase();
    return {
      platform: capPlatform === 'ios' ? 'capacitor-ios' : 'capacitor-android',
      isInstalledApp: true,
    };
  }

  const isInstalledApp = Boolean(
    input.isStandaloneDisplayMode || input.navigatorStandalone === true
  );

  if (/android/.test(ua)) {
    return { platform: 'android-browser', isInstalledApp };
  }

  if (/iphone|ipad|ipod/.test(ua)) {
    return { platform: 'ios-safari', isInstalledApp };
  }

  return { platform: 'desktop-browser', isInstalledApp };
}

export function resolveInstallButtonMode(params: {
  platform: InstallPlatform;
  isInstalledApp: boolean;
  hasDeferredPrompt: boolean;
  hasApkDownloadUrl?: boolean;
}): InstallButtonMode {
  if (params.isInstalledApp) {
    return 'hidden';
  }
  if (params.platform === 'ios-safari') {
    return 'ios-guide';
  }
  // When a GitHub Releases APK URL is available, route "Android App" directly to the latest APK
  if (params.hasApkDownloadUrl) {
    return 'apk-download';
  }
  if (params.hasDeferredPrompt) {
    return 'native-prompt';
  }
  return 'android-guide';
}
