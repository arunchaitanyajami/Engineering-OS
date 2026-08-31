export const sleepWithSignal = async (
  ms: number,
  signal?: AbortSignal
): Promise<void> => {
  if (ms <= 0) {
    return;
  }

  if (signal?.aborted) {
    throw toAbortError(signal);
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeout);
      reject(toAbortError(signal));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
};

export const toAbortError = (signal?: AbortSignal): Error => {
  if (signal?.reason instanceof Error) {
    return signal.reason;
  }

  return new DOMException("This operation was aborted.", "AbortError");
};

export const isAbortError = (error: unknown): boolean =>
  (error instanceof Error && error.name === "AbortError") ||
  (typeof DOMException !== "undefined" &&
    error instanceof DOMException &&
    error.name === "AbortError");

export const parseNextLink = (headers: Headers): string | null => {
  const link = headers.get("link");

  if (!link) {
    return null;
  }

  const matches = [...link.matchAll(/<([^>]+)>\s*;\s*rel="?([^",;]+)"?/g)];
  const next = matches.find((match) => match[2] === "next");

  return next?.[1] ?? null;
};

export const encodeGitHubContentPath = (path: string): string =>
  path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
