export interface GitHubRateLimit {
  readonly limit: number;
  readonly remaining: number;
  readonly resetAt: string;
  readonly resource?: string;
}

const readHeader = (headers: Headers, name: string): string | undefined =>
  headers.get(name) ?? undefined;

const parseNonNegativeInteger = (
  value: string | undefined
): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }

  return parsed;
};

export const parseGitHubRateLimit = (
  headers: Headers
): GitHubRateLimit | null => {
  const limit = parseNonNegativeInteger(
    readHeader(headers, "x-ratelimit-limit")
  );
  const remaining = parseNonNegativeInteger(
    readHeader(headers, "x-ratelimit-remaining")
  );
  const resetUnixSeconds = parseNonNegativeInteger(
    readHeader(headers, "x-ratelimit-reset")
  );

  if (
    limit === undefined ||
    remaining === undefined ||
    resetUnixSeconds === undefined
  ) {
    return null;
  }

  const resource = readHeader(headers, "x-ratelimit-resource");

  return {
    limit,
    remaining,
    resetAt: new Date(resetUnixSeconds * 1000).toISOString(),
    ...(resource ? { resource } : {})
  };
};

export const parseRetryAfterMs = (
  headers: Headers,
  now: Date
): number | null => {
  const retryAfter = readHeader(headers, "retry-after");

  if (retryAfter !== undefined) {
    const retryAfterSeconds = Number.parseInt(retryAfter, 10);

    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
      return retryAfterSeconds * 1000;
    }
  }

  const rateLimit = parseGitHubRateLimit(headers);

  if (!rateLimit) {
    return null;
  }

  return Math.max(0, Date.parse(rateLimit.resetAt) - now.getTime());
};

export const isGitHubRateLimitResponse = (
  status: number,
  headers: Headers,
  bodyText: string
): boolean => {
  if (status === 429) {
    return true;
  }

  if (status !== 403) {
    return false;
  }

  const remaining = parseNonNegativeInteger(
    readHeader(headers, "x-ratelimit-remaining")
  );

  if (remaining === 0) {
    return true;
  }

  return /rate limit/i.test(bodyText);
};
