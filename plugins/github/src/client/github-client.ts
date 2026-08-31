import { z } from "zod";

import type {
  ChangedFile,
  Commit,
  FileContent,
  PullRequest,
  PullRequestComment,
  Repository
} from "@engineering-os/source-control-domain";

import { mapChangedFile } from "../mappers/changed-file.mapper.js";
import { mapPullRequestComment } from "../mappers/comment.mapper.js";
import { mapCommit, mapFileContent } from "../mappers/content.mapper.js";
import { mapPullRequest } from "../mappers/pull-request.mapper.js";
import { mapRepository } from "../mappers/repository.mapper.js";
import { githubApiHost } from "../permissions/github-permissions.js";
import { GitHubPluginError, redactSecrets } from "./github-errors.js";
import {
  getCommitInputSchema,
  getFileContentInputSchema,
  getPullRequestInputSchema,
  listPullRequestsInputSchema,
  listRepositoriesInputSchema,
  type GetCommitInput,
  type GetFileContentInput,
  type GetPullRequestCommentsInput,
  type GetPullRequestFilesInput,
  type GetPullRequestInput,
  type GitHubClient,
  type ListPullRequestsInput,
  type ListRepositoriesInput
} from "./github-client.types.js";
import {
  encodeGitHubContentPath,
  isAbortError,
  parseNextLink,
  sleepWithSignal,
  toAbortError
} from "./http.js";
import {
  isGitHubRateLimitResponse,
  parseGitHubRateLimit,
  parseRetryAfterMs,
  type GitHubRateLimit
} from "./rate-limit.js";

export interface GitHubClientDependencies {
  fetch?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => Date;
  maxRetries?: number;
  maxRetryWaitMs?: number;
  maxPages?: number;
  apiBaseUrl?: string;
  userAgent?: string;
}

type NotFoundCode = "REPOSITORY_NOT_FOUND" | "PULL_REQUEST_NOT_FOUND";

interface GitHubHttpResult {
  readonly status: number;
  readonly headers: Headers;
  readonly data: unknown;
}

const defaultApiBaseUrl = `https://${githubApiHost}`;

const parseClientInput = <TValue>(
  schema: z.ZodType<TValue>,
  input: unknown,
  label: string
): TValue => {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw new GitHubPluginError({
      code: "VALIDATION_ERROR",
      message: `Invalid ${label} input.`,
      retryable: false
    });
  }

  return result.data;
};

export const createGitHubClient = (options: {
  token: string;
  dependencies?: GitHubClientDependencies;
  signal?: AbortSignal;
}): GitHubClient => {
  const token = options.token;
  const fetchImpl = options.dependencies?.fetch ?? fetch;
  const sleep = options.dependencies?.sleep ?? sleepWithSignal;
  const now = options.dependencies?.now ?? (() => new Date());
  const maxRetries = options.dependencies?.maxRetries ?? 2;
  const maxRetryWaitMs = options.dependencies?.maxRetryWaitMs ?? 5_000;
  const maxPages = options.dependencies?.maxPages ?? 50;
  const apiBaseUrl = options.dependencies?.apiBaseUrl ?? defaultApiBaseUrl;
  const userAgent =
    options.dependencies?.userAgent ?? "engineering-os-github-plugin/0.1.0";
  const clientSignal = options.signal;

  let rateLimit: GitHubRateLimit | null = null;

  const requestJson = async (input: {
    method: "GET";
    path?: string;
    url?: string;
    query?: Record<string, string>;
    notFoundCode?: NotFoundCode;
    signal?: AbortSignal;
  }): Promise<GitHubHttpResult> => {
    const signal = mergeSignals(clientSignal, input.signal);

    if (signal?.aborted) {
      throw toAbortError(signal);
    }

    const url =
      input.url ?? buildUrl(apiBaseUrl, input.path ?? "/", input.query);
    assertRequestUrl(url, apiBaseUrl);

    let attempt = 0;

    while (true) {
      let response: Response;

      try {
        response = await fetchImpl(url, {
          method: input.method,
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": userAgent
          },
          ...(signal ? { signal } : {})
        });
      } catch (error) {
        if (isAbortError(error) || signal?.aborted) {
          throw isAbortError(error) ? error : toAbortError(signal);
        }

        throw new GitHubPluginError({
          code: "NETWORK_ERROR",
          message: "GitHub request failed before a response was received.",
          retryable: true
        });
      }

      rateLimit = parseGitHubRateLimit(response.headers) ?? rateLimit;
      const bodyText = await response.text();

      if (response.ok) {
        return {
          status: response.status,
          headers: response.headers,
          data: bodyText.length === 0 ? null : parseJsonBody(bodyText)
        };
      }

      if (
        isGitHubRateLimitResponse(
          response.status,
          response.headers,
          bodyText
        ) &&
        attempt < maxRetries
      ) {
        const waitMs = parseRetryAfterMs(response.headers, now()) ?? 1_000;

        if (waitMs <= maxRetryWaitMs) {
          attempt += 1;
          await sleep(waitMs, signal);
          continue;
        }
      }

      throw mapHttpError({
        status: response.status,
        headers: response.headers,
        bodyText,
        ...(input.notFoundCode ? { notFoundCode: input.notFoundCode } : {}),
        rateLimit
      });
    }
  };

  const paginate = async <TItem>(input: {
    path: string;
    query?: Record<string, string>;
    notFoundCode?: NotFoundCode;
    signal?: AbortSignal;
    mapItem: (payload: unknown) => TItem;
  }): Promise<TItem[]> => {
    const items: TItem[] = [];
    let nextUrl: string | undefined;
    let page = 0;

    while (page < maxPages) {
      const result = await requestJson({
        method: "GET",
        ...(nextUrl
          ? { url: nextUrl }
          : {
              path: input.path,
              query: { per_page: "100", ...input.query }
            }),
        ...(input.notFoundCode ? { notFoundCode: input.notFoundCode } : {}),
        ...(input.signal ? { signal: input.signal } : {})
      });

      if (!Array.isArray(result.data)) {
        throw new GitHubPluginError({
          code: "VALIDATION_ERROR",
          message: "GitHub list response was not an array.",
          retryable: false
        });
      }

      items.push(...result.data.map((payload) => input.mapItem(payload)));
      page += 1;

      const parsedNext = parseNextLink(result.headers);

      if (!parsedNext) {
        return items;
      }

      nextUrl = parsedNext;
    }

    throw new GitHubPluginError({
      code: "VALIDATION_ERROR",
      message: "GitHub pagination exceeded the allowed page limit.",
      retryable: false
    });
  };

  return {
    async listRepositories(input: ListRepositoriesInput = {}) {
      const parsed = parseClientInput(
        listRepositoriesInputSchema,
        input,
        "list repositories"
      );
      const query: Record<string, string> = {};

      if (parsed.visibility) {
        query.visibility = parsed.visibility;
      }

      if (parsed.affiliation) {
        query.affiliation = parsed.affiliation;
      }

      return paginate<Repository>({
        path: "/user/repos",
        query,
        mapItem: mapRepository
      });
    },

    async listPullRequests(input: ListPullRequestsInput) {
      const parsed = parseClientInput(
        listPullRequestsInputSchema,
        input,
        "list pull requests"
      );

      return paginate<PullRequest>({
        path: `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repository)}/pulls`,
        query: { state: parsed.state ?? "open" },
        notFoundCode: "REPOSITORY_NOT_FOUND",
        mapItem: (payload) =>
          mapPullRequest(payload, {
            owner: parsed.owner,
            name: parsed.repository
          })
      });
    },

    async getPullRequest(input: GetPullRequestInput) {
      const parsed = parseClientInput(
        getPullRequestInputSchema,
        input,
        "get pull request"
      );
      const result = await requestJson({
        method: "GET",
        path: `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repository)}/pulls/${parsed.number}`,
        notFoundCode: "PULL_REQUEST_NOT_FOUND"
      });

      return mapPullRequest(result.data, {
        owner: parsed.owner,
        name: parsed.repository
      });
    },

    async getPullRequestFiles(input: GetPullRequestFilesInput) {
      const parsed = parseClientInput(
        getPullRequestInputSchema,
        input,
        "get pull request files"
      );

      return paginate<ChangedFile>({
        path: `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repository)}/pulls/${parsed.number}/files`,
        notFoundCode: "PULL_REQUEST_NOT_FOUND",
        mapItem: mapChangedFile
      });
    },

    async getFileContent(input: GetFileContentInput) {
      const parsed = parseClientInput(
        getFileContentInputSchema,
        input,
        "get file content"
      );

      if (parsed.path.split("/").includes("..")) {
        throw new GitHubPluginError({
          code: "VALIDATION_ERROR",
          message: "File path must not contain traversal segments.",
          retryable: false
        });
      }

      const query: Record<string, string> = {};

      if (parsed.ref) {
        query.ref = parsed.ref;
      }

      const result = await requestJson({
        method: "GET",
        path: `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repository)}/contents/${encodeGitHubContentPath(parsed.path)}`,
        ...(Object.keys(query).length > 0 ? { query } : {}),
        notFoundCode: "REPOSITORY_NOT_FOUND"
      });

      return mapFileContent(result.data) satisfies FileContent;
    },

    async getCommit(input: GetCommitInput) {
      const parsed = parseClientInput(
        getCommitInputSchema,
        input,
        "get commit"
      );
      const result = await requestJson({
        method: "GET",
        path: `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repository)}/commits/${encodeURIComponent(parsed.ref)}`,
        notFoundCode: "REPOSITORY_NOT_FOUND"
      });

      return mapCommit(result.data) satisfies Commit;
    },

    async getPullRequestComments(input: GetPullRequestCommentsInput) {
      const parsed = parseClientInput(
        getPullRequestInputSchema,
        input,
        "get pull request comments"
      );
      const repositoryPath = `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repository)}`;

      const [inlineComments, conversationComments] = await Promise.all([
        paginate<PullRequestComment>({
          path: `${repositoryPath}/pulls/${parsed.number}/comments`,
          notFoundCode: "PULL_REQUEST_NOT_FOUND",
          mapItem: (payload) => mapPullRequestComment(payload, parsed.number)
        }),
        paginate<PullRequestComment>({
          path: `${repositoryPath}/issues/${parsed.number}/comments`,
          notFoundCode: "PULL_REQUEST_NOT_FOUND",
          mapItem: (payload) => mapPullRequestComment(payload, parsed.number)
        })
      ]);

      return [...inlineComments, ...conversationComments];
    },

    getRateLimit() {
      return rateLimit;
    }
  };
};

const buildUrl = (
  apiBaseUrl: string,
  path: string,
  query?: Record<string, string>
): string => {
  const url = new URL(path.startsWith("http") ? path : `${apiBaseUrl}${path}`);

  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }

  return url.toString();
};

const assertRequestUrl = (url: string, apiBaseUrl: string): void => {
  const requestUrl = new URL(url);
  const allowedOrigin = new URL(apiBaseUrl).origin;

  if (requestUrl.origin !== allowedOrigin) {
    throw new GitHubPluginError({
      code: "VALIDATION_ERROR",
      message: "GitHub pagination link pointed at an unexpected host.",
      retryable: false
    });
  }
};

const parseJsonBody = (bodyText: string): unknown => {
  try {
    return JSON.parse(bodyText) as unknown;
  } catch {
    throw new GitHubPluginError({
      code: "VALIDATION_ERROR",
      message: "GitHub response was not valid JSON.",
      retryable: false
    });
  }
};

const mergeSignals = (
  left?: AbortSignal,
  right?: AbortSignal
): AbortSignal | undefined => {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return AbortSignal.any([left, right]);
};

const readGitHubMessage = (bodyText: string): string => {
  try {
    const parsed = JSON.parse(bodyText) as { message?: unknown };

    if (
      typeof parsed.message === "string" &&
      parsed.message.trim().length > 0
    ) {
      return redactSecrets(parsed.message);
    }
  } catch {
    // The response body is untrusted diagnostic text only.
  }

  return "GitHub request failed.";
};

const mapHttpError = (input: {
  status: number;
  headers: Headers;
  bodyText: string;
  notFoundCode?: NotFoundCode;
  rateLimit: GitHubRateLimit | null;
}): GitHubPluginError => {
  if (isGitHubRateLimitResponse(input.status, input.headers, input.bodyText)) {
    return new GitHubPluginError({
      code: "RATE_LIMITED",
      message: "GitHub API rate limit exceeded.",
      retryable: true,
      metadata: {
        ...(input.rateLimit ?? {})
      }
    });
  }

  if (input.status === 401) {
    return new GitHubPluginError({
      code: "AUTHENTICATION_FAILED",
      message: "GitHub authentication failed.",
      retryable: false
    });
  }

  if (input.status === 403) {
    return new GitHubPluginError({
      code: "PERMISSION_DENIED",
      message: "GitHub permission was denied.",
      retryable: false
    });
  }

  if (input.status === 404) {
    return new GitHubPluginError({
      code: input.notFoundCode ?? "UNKNOWN",
      message:
        input.notFoundCode === "PULL_REQUEST_NOT_FOUND"
          ? "GitHub pull request was not found."
          : input.notFoundCode === "REPOSITORY_NOT_FOUND"
            ? "GitHub repository was not found."
            : "GitHub resource was not found.",
      retryable: false
    });
  }

  if (input.status === 422) {
    return new GitHubPluginError({
      code: "VALIDATION_ERROR",
      message: readGitHubMessage(input.bodyText),
      retryable: false
    });
  }

  if (input.status >= 500) {
    return new GitHubPluginError({
      code: "NETWORK_ERROR",
      message: "GitHub is temporarily unavailable.",
      retryable: true
    });
  }

  return new GitHubPluginError({
    code: "UNKNOWN",
    message: readGitHubMessage(input.bodyText),
    retryable: false
  });
};
