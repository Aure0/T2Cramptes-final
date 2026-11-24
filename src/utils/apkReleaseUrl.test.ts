import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANDROID_APK_ASSET_NAME,
  inferGitHubRepoFromLocation,
  resolveApkReleaseInfo,
} from './apkReleaseUrl';

test('inferGitHubRepoFromLocation parses project GitHub Pages URLs', () => {
  assert.equal(
    inferGitHubRepoFromLocation('https://aurelien.github.io/t2c-clermont-live/?lines=A,B'),
    'aurelien/t2c-clermont-live'
  );
  assert.equal(
    inferGitHubRepoFromLocation('https://aurelien.github.io/'),
    'aurelien/aurelien.github.io'
  );
  assert.equal(inferGitHubRepoFromLocation('http://localhost:3000/'), null);
  assert.equal(inferGitHubRepoFromLocation('https://example.com/app/'), null);
});

test('resolveApkReleaseInfo prioritizes explicit VITE_ANDROID_APK_URL', () => {
  const info = resolveApkReleaseInfo({
    envApkUrl: 'https://github.com/custom/repo/releases/download/v1.0/custom.apk',
    envGithubRepo: 'ignored/repo',
    locationHref: 'https://other.github.io/app/',
  });
  assert.deepEqual(info, {
    apkDownloadUrl: 'https://github.com/custom/repo/releases/download/v1.0/custom.apk',
    releasesPageUrl: 'https://github.com/ignored/repo/releases/latest',
    repoSlug: 'ignored/repo',
  });
});

test('resolveApkReleaseInfo builds latest release download URL from VITE_GITHUB_REPO', () => {
  const info = resolveApkReleaseInfo({
    envGithubRepo: 'aveillet/t2c-live',
    locationHref: 'http://localhost:3000/',
  });
  assert.deepEqual(info, {
    apkDownloadUrl: `https://github.com/aveillet/t2c-live/releases/latest/download/${ANDROID_APK_ASSET_NAME}`,
    releasesPageUrl: 'https://github.com/aveillet/t2c-live/releases/latest',
    repoSlug: 'aveillet/t2c-live',
  });
});

test('resolveApkReleaseInfo auto-detects from GitHub Pages location when env vars are empty', () => {
  const info = resolveApkReleaseInfo({
    envApkUrl: '',
    envGithubRepo: '',
    locationHref: 'https://aveillet.github.io/t2c-clermont-live/',
  });
  assert.deepEqual(info, {
    apkDownloadUrl: `https://github.com/aveillet/t2c-clermont-live/releases/latest/download/${ANDROID_APK_ASSET_NAME}`,
    releasesPageUrl: 'https://github.com/aveillet/t2c-clermont-live/releases/latest',
    repoSlug: 'aveillet/t2c-clermont-live',
  });
});

test('resolveApkReleaseInfo returns null on local dev when no repo or URL is configured', () => {
  assert.equal(
    resolveApkReleaseInfo({
      envApkUrl: '',
      envGithubRepo: '',
      locationHref: 'http://localhost:3000/',
    }),
    null
  );
});
