export const ANDROID_APK_ASSET_NAME = 'T2Cramptes-latest.apk';

export interface ApkReleaseInfo {
  apkDownloadUrl: string;
  releasesPageUrl: string | null;
  repoSlug: string | null;
}

export interface ResolveApkReleaseInput {
  envApkUrl?: string | null;
  envGithubRepo?: string | null;
  locationHref?: string | null;
}

function sanitizeHttpUrl(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    return null;
  }
  return null;
}

function sanitizeRepoSlug(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^\/+|\/+$/g, '');
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

/**
 * Infers "owner/repo" when the app is hosted on GitHub Pages (https://<owner>.github.io/<repo>/).
 */
export function inferGitHubRepoFromLocation(locationHref?: string | null): string | null {
  if (!locationHref) return null;
  try {
    const url = new URL(locationHref);
    const host = url.hostname.toLowerCase();
    if (!host.endsWith('.github.io')) return null;

    const owner = host.slice(0, -'.github.io'.length);
    if (!owner || owner.includes('.')) return null;

    const segments = url.pathname
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean);

    const repo = segments.length > 0 ? segments[0] : `${owner}.github.io`;
    return sanitizeRepoSlug(`${owner}/${repo}`);
  } catch {
    return null;
  }
}

/**
 * Resolves the latest GitHub Releases Android APK download URL.
 * Priority:
 * 1. Explicit VITE_ANDROID_APK_URL environment variable
 * 2. Explicit VITE_GITHUB_REPO (automatically injected during GitHub Pages workflow)
 * 3. Automatic inference from *.github.io hosting URL
 */
export function resolveApkReleaseInfo(
  input: ResolveApkReleaseInput
): ApkReleaseInfo | null {
  const explicitApkUrl = sanitizeHttpUrl(input.envApkUrl);
  const repoSlug =
    sanitizeRepoSlug(input.envGithubRepo) ||
    inferGitHubRepoFromLocation(input.locationHref);

  if (explicitApkUrl) {
    return {
      apkDownloadUrl: explicitApkUrl,
      releasesPageUrl: repoSlug
        ? `https://github.com/${repoSlug}/releases/latest`
        : null,
      repoSlug,
    };
  }

  if (repoSlug) {
    return {
      apkDownloadUrl: `https://github.com/${repoSlug}/releases/latest/download/${ANDROID_APK_ASSET_NAME}`,
      releasesPageUrl: `https://github.com/${repoSlug}/releases/latest`,
      repoSlug,
    };
  }

  return null;
}
