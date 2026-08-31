import { invoke } from "@tauri-apps/api/core";

interface TauriBackendConnectionResponse {
  readonly baseUrl: string;
  readonly authorizationToken: string;
}

const BACKEND_RETRY_ATTEMPTS = 10;
const BACKEND_RETRY_DELAY_MS = 150;
let cachedBackendConnection: TauriBackendConnectionResponse | null = null;

export const isTauriEnvironment = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const isE2eBackendMode = (): boolean =>
  import.meta.env.VITE_E2E_BACKEND === "true";

export const isDesktopBackendAvailable = (): boolean =>
  isTauriEnvironment() || isE2eBackendMode();

const resolveE2eBackendConnection = (): TauriBackendConnectionResponse => {
  const baseUrl = import.meta.env.VITE_E2E_BACKEND_URL?.trim();
  const authorizationToken = import.meta.env.VITE_E2E_BACKEND_TOKEN?.trim();

  if (!baseUrl || !authorizationToken) {
    throw new Error(
      "Playwright E2E backend mode requires VITE_E2E_BACKEND_URL and VITE_E2E_BACKEND_TOKEN."
    );
  }

  return {
    baseUrl,
    authorizationToken
  };
};

const resolveBackendConnection =
  async (): Promise<TauriBackendConnectionResponse> => {
    if (cachedBackendConnection) {
      return cachedBackendConnection;
    }

    if (isE2eBackendMode()) {
      cachedBackendConnection = resolveE2eBackendConnection();
      return cachedBackendConnection;
    }

    cachedBackendConnection = await invoke<TauriBackendConnectionResponse>(
      "get_backend_connection"
    );
    return cachedBackendConnection;
  };

const parseBackendError = async (response: Response): Promise<Error> => {
  try {
    const payload = (await response.json()) as {
      readonly code?: string;
      readonly message?: string;
    };

    return new Error(
      payload.message ??
        `Desktop backend request failed with status ${response.status}.`
    );
  } catch {
    return new Error(
      `Desktop backend request failed with status ${response.status}.`
    );
  }
};

const wait = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });

const isRetryableBackendError = (error: unknown): boolean =>
  error instanceof TypeError ||
  (error instanceof Error &&
    /fetch|network|load failed|failed to fetch/i.test(error.message));

export const requestDesktopBackend = async <T>(
  path: string,
  init?: RequestInit
): Promise<T> => {
  if (!isDesktopBackendAvailable()) {
    throw new Error(
      "Desktop backend APIs are only available inside the Tauri runtime or Playwright E2E mode."
    );
  }

  const connection = await resolveBackendConnection();

  for (let attempt = 1; attempt <= BACKEND_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${connection.baseUrl}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${connection.authorizationToken}`,
          "content-type": "application/json",
          ...(init?.headers ?? {})
        }
      });

      if (!response.ok) {
        throw await parseBackendError(response);
      }

      return (await response.json()) as T;
    } catch (error) {
      const canRetry =
        attempt < BACKEND_RETRY_ATTEMPTS && isRetryableBackendError(error);

      if (!canRetry) {
        throw error;
      }

      await wait(BACKEND_RETRY_DELAY_MS * attempt);
    }
  }

  throw new Error("Desktop backend request retry budget was exhausted.");
};
