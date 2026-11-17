/** Only releases from the project's public, pinned GitHub repository are considered.
 * A browser/system installer performs the final Android APK signature check.
 * No untrusted URL is accepted from the WebView. */
const API = 'https://api.github.com/repos/Chimera1988/connect-android/releases/latest';
const PREFIX = 'https://github.com/Chimera1988/connect-android/releases/download/';
const TAG = /^connect-android-v([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})-b([1-9][0-9]{0,8})$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export type ConnectApkCandidate = {
  version: string;
  build: number;
  size: number;
  sha256: string;
  url: string;
  checkedAt: number;
};
export type ConnectApkCheck = {
  state: 'available' | 'current' | 'unpublished';
  version?: string;
  build?: number;
  size?: number;
  candidate?: ConnectApkCandidate;
};

function entry(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Pure validation; reject releases with missing digests, different paths or any ambiguous APK assets. */
export function parseConnectApkRelease(value: unknown, installedBuild: number): ConnectApkCheck {
  const release = entry(value);
  if (!release || release.draft !== false || release.prerelease !== false) throw Error('Некорректные данные выпуска Connect');
  const tag = release.tag_name;
  const match = typeof tag === 'string' ? TAG.exec(tag) : null;
  if (!match) throw Error('Неподдерживаемый формат версии Android');
  const version = match[1], build = Number(match[2]);
  if (!Number.isSafeInteger(build) || build < 1 || build > 2000000000) throw Error('Некорректный номер Android-сборки');
  if (!Array.isArray(release.assets)) throw Error('В выпуске отсутствует подписанный APK');
  const assets = release.assets.filter(asset => entry(asset)?.name === 'Connect.apk');
  if (assets.length !== 1) throw Error('Ожидался ровно один Connect.apk');
  const apk = entry(assets[0])!;
  const expected = PREFIX + tag + '/Connect.apk';
  if (apk.state !== 'uploaded' || apk.browser_download_url !== expected ||
      !Number.isSafeInteger(apk.size) || (apk.size as number) < 5_000_000 || (apk.size as number) > 200_000_000 ||
      typeof apk.digest !== 'string' || !DIGEST.test(apk.digest)) {
    throw Error('APK не прошёл проверку адреса, размера и SHA-256');
  }
  if (!Number.isSafeInteger(installedBuild) || installedBuild < 1) throw Error('Не удалось определить номер установленного APK');
  if (build <= installedBuild) return {state: 'current', version, build};
  const candidate: ConnectApkCandidate = {
    version, build, size: apk.size as number, sha256: apk.digest.slice(7), url: expected, checkedAt: Date.now(),
  };
  return {state: 'available', version, build, size: candidate.size, candidate};
}

export async function checkConnectApkRelease(installedBuild: number): Promise<ConnectApkCheck> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 12000);
  try {
    const response = await fetch(API, {
      method: 'GET',
      headers: {'Accept': 'application/vnd.github+json', 'User-Agent': 'Connect-Android-Updater'},
      signal: timeout.signal,
    });
    if (response.status === 404) return {state: 'unpublished'};
    if (!response.ok) throw Error('GitHub не подтвердил доступность обновлений (' + response.status + ')');
    return parseConnectApkRelease(await response.json() as unknown, installedBuild);
  } catch (error) {
    if (timeout.signal.aborted) throw Error('Превышено время ожидания ответа GitHub');
    throw error;
  } finally {clearTimeout(timer);}
}
