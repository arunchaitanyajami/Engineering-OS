export const githubErrorCodes = [
  "AUTHENTICATION_FAILED",
  "PERMISSION_DENIED",
  "RATE_LIMITED",
  "REPOSITORY_NOT_FOUND",
  "PULL_REQUEST_NOT_FOUND",
  "NETWORK_ERROR",
  "VALIDATION_ERROR",
  "UNKNOWN"
] as const;

export type GitHubErrorCode = (typeof githubErrorCodes)[number];

export interface GitHubPluginErrorOptions {
  readonly code: GitHubErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export class GitHubPluginError extends Error {
  readonly code: GitHubErrorCode;
  readonly retryable: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;

  constructor(options: GitHubPluginErrorOptions) {
    super(redactSecrets(options.message));
    this.name = "GitHubPluginError";
    this.code = options.code;
    this.retryable = options.retryable;
    if (options.metadata) {
      this.metadata = options.metadata;
    }
  }
}

export const isGitHubPluginError = (
  error: unknown
): error is GitHubPluginError => error instanceof GitHubPluginError;

const secretPattern =
  /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|Bearer\s+\S+/gi;

export const redactSecrets = (value: string): string =>
  value.replace(secretPattern, "[redacted]");
