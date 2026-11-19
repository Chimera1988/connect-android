/** Retry only transient network failures of Expo asset downloads. */
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [2500, 6500] as const;

export function isTransientOtaFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  // Never retry integrity, signing, permission, or version-compatibility failures.
  if (/signature|certificate|integrity|checksum|hash mismatch|incompatible|invalid manifest|unauthorized|forbidden|\b40[0134]\b/i.test(message)) return false;
  return /timeout|timed out|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|ENOTFOUND|network is unreachable|connection (?:reset|refused|lost|timed out)|unable to resolve host|temporary failure in name resolution|\b(?:502|503|504)\b/i.test(message);
}

export type OtaRetryNotice = {attempt: number; maxAttempts: number; waitMs: number};

export async function downloadOtaWithNetworkRetry<T>(
  download: () => Promise<T>,
  onRetry: (notice: OtaRetryNotice) => void,
  sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try { return await download(); }
    catch (error) {
      if (attempt === MAX_ATTEMPTS || !isTransientOtaFailure(error)) throw error;
      const waitMs = RETRY_DELAYS_MS[attempt - 1];
      onRetry({attempt: attempt + 1, maxAttempts: MAX_ATTEMPTS, waitMs});
      await sleep(waitMs);
    }
  }
  throw new Error('All OTA download attempts exhausted');
}
