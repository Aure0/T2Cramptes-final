import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectInstallPlatform,
  resolveInstallButtonMode,
} from './pwaInstallLogic';

test('detectInstallPlatform identifies Android Chrome browser', () => {
  const res = detectInstallPlatform({
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
    isStandaloneDisplayMode: false,
  });
  assert.equal(res.platform, 'android-browser');
  assert.equal(res.isInstalledApp, false);
});

test('detectInstallPlatform identifies installed Android standalone PWA', () => {
  const res = detectInstallPlatform({
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/129.0.0.0 Mobile',
    isStandaloneDisplayMode: true,
  });
  assert.equal(res.platform, 'android-browser');
  assert.equal(res.isInstalledApp, true);
});

test('detectInstallPlatform identifies native Capacitor Android app', () => {
  const res = detectInstallPlatform({
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36',
    isStandaloneDisplayMode: false,
    isCapacitorNative: true,
    capacitorPlatform: 'android',
  });
  assert.equal(res.platform, 'capacitor-android');
  assert.equal(res.isInstalledApp, true);
});

test('detectInstallPlatform identifies iOS Safari and standalone mode', () => {
  const browser = detectInstallPlatform({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari/604.1',
    isStandaloneDisplayMode: false,
    navigatorStandalone: false,
  });
  assert.equal(browser.platform, 'ios-safari');
  assert.equal(browser.isInstalledApp, false);

  const installed = detectInstallPlatform({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari/604.1',
    isStandaloneDisplayMode: false,
    navigatorStandalone: true,
  });
  assert.equal(installed.platform, 'ios-safari');
  assert.equal(installed.isInstalledApp, true);
});

test('resolveInstallButtonMode hides button when already installed', () => {
  assert.equal(
    resolveInstallButtonMode({
      platform: 'android-browser',
      isInstalledApp: true,
      hasDeferredPrompt: true,
      hasApkDownloadUrl: true,
    }),
    'hidden'
  );
  assert.equal(
    resolveInstallButtonMode({
      platform: 'capacitor-android',
      isInstalledApp: true,
      hasDeferredPrompt: false,
      hasApkDownloadUrl: true,
    }),
    'hidden'
  );
});

test('resolveInstallButtonMode prefers direct apk-download on Android and desktop when APK URL is available', () => {
  assert.equal(
    resolveInstallButtonMode({
      platform: 'android-browser',
      isInstalledApp: false,
      hasDeferredPrompt: true,
      hasApkDownloadUrl: true,
    }),
    'apk-download'
  );
  assert.equal(
    resolveInstallButtonMode({
      platform: 'desktop-browser',
      isInstalledApp: false,
      hasDeferredPrompt: false,
      hasApkDownloadUrl: true,
    }),
    'apk-download'
  );
  // iOS cannot install Android APKs, so it stays on ios-guide
  assert.equal(
    resolveInstallButtonMode({
      platform: 'ios-safari',
      isInstalledApp: false,
      hasDeferredPrompt: false,
      hasApkDownloadUrl: true,
    }),
    'ios-guide'
  );
});

test('resolveInstallButtonMode prefers native prompt when no APK URL is configured and prompt is ready', () => {
  assert.equal(
    resolveInstallButtonMode({
      platform: 'android-browser',
      isInstalledApp: false,
      hasDeferredPrompt: true,
      hasApkDownloadUrl: false,
    }),
    'native-prompt'
  );
  assert.equal(
    resolveInstallButtonMode({
      platform: 'desktop-browser',
      isInstalledApp: false,
      hasDeferredPrompt: true,
      hasApkDownloadUrl: false,
    }),
    'native-prompt'
  );
});

test('resolveInstallButtonMode falls back to platform-appropriate guide without APK URL or deferred prompt', () => {
  assert.equal(
    resolveInstallButtonMode({
      platform: 'android-browser',
      isInstalledApp: false,
      hasDeferredPrompt: false,
    }),
    'android-guide'
  );
  assert.equal(
    resolveInstallButtonMode({
      platform: 'ios-safari',
      isInstalledApp: false,
      hasDeferredPrompt: false,
    }),
    'ios-guide'
  );
  assert.equal(
    resolveInstallButtonMode({
      platform: 'desktop-browser',
      isInstalledApp: false,
      hasDeferredPrompt: false,
    }),
    'android-guide'
  );
});
