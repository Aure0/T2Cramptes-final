import { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { resolveApkReleaseInfo } from '../utils/apkReleaseUrl';

export interface AppUpdateState {
  updateAvailable: boolean;
  latestLabel: string | null;
  downloadUrl: string | null;
  dismiss: () => void;
}

const INSTALLED_BUILD_NUMBER = Number(import.meta.env.VITE_APP_BUILD_NUMBER || '0');
const INSTALLED_COMMIT_SHA = (import.meta.env.VITE_APP_COMMIT_SHA || '').trim().toLowerCase();

/**
 * Checks GitHub Releases API once when running inside the native Android Capacitor APK
 * to notify the user if a newer build of T2Cramptés is available for download.
 */
export function useAppUpdateCheck(): AppUpdateState {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestLabel, setLatestLabel] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const dismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const releaseInfo = resolveApkReleaseInfo({
      envApkUrl: import.meta.env.VITE_ANDROID_APK_URL,
      envGithubRepo: import.meta.env.VITE_GITHUB_REPO,
      locationHref: typeof window !== 'undefined' ? window.location.href : null,
    });
    if (!releaseInfo?.repoSlug) return;

    const controller = new AbortController();
    const apiUrl = `https://api.github.com/repos/${releaseInfo.repoSlug}/releases/latest`;

    fetch(apiUrl, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          payload: {
            body?: string;
            name?: string;
            tag_name?: string;
            target_commitish?: string;
            assets?: Array<{ name?: string; browser_download_url?: string }>;
          } | null
        ) => {
          if (!payload || controller.signal.aborted) return;

          const body = payload.body || '';
          const buildMatch = /build\s*#?(\d+)/i.exec(body);
          const remoteBuild = buildMatch ? Number(buildMatch[1]) : 0;

          const shaMatch = /commit\s+`([0-9a-f]{7,40})`/i.exec(body);
          const remoteSha = (shaMatch?.[1] || payload.target_commitish || '').toLowerCase();

          let isNewer = false;
          if (remoteBuild > 0 && INSTALLED_BUILD_NUMBER > 0) {
            isNewer = remoteBuild > INSTALLED_BUILD_NUMBER;
          } else if (
            remoteSha.length >= 7 &&
            INSTALLED_COMMIT_SHA.length >= 7 &&
            !remoteSha.startsWith(INSTALLED_COMMIT_SHA.slice(0, 7))
          ) {
            isNewer = true;
          }

          if (!isNewer) return;

          const apkAsset = payload.assets?.find((a) =>
            (a.name || '').toLowerCase().endsWith('.apk')
          );
          setDownloadUrl(apkAsset?.browser_download_url || releaseInfo.apkDownloadUrl);
          setLatestLabel(
            remoteBuild > 0
              ? `v1.0.${remoteBuild}`
              : remoteSha
                ? remoteSha.slice(0, 7)
                : payload.tag_name || 'latest'
          );
          setUpdateAvailable(true);
        }
      )
      .catch(() => {
        // Silently ignore offline / GitHub rate-limit errors
      });

    return () => controller.abort();
  }, []);

  return {
    updateAvailable: updateAvailable && !dismissed,
    latestLabel,
    downloadUrl,
    dismiss,
  };
}
