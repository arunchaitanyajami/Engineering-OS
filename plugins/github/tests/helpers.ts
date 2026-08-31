export const gitSha = "a1b2c3d4e5f6789012345678901234567890abcd";
export const headSha = "b2c3d4e5f6789012345678901234567890abcde1";
export const testToken = "ghp_testtokenvalue1234567890";

export const githubRepositoryPayload = {
  name: "payments",
  full_name: "acme/payments",
  private: true,
  html_url: "https://github.com/acme/payments",
  description: "Payment services",
  default_branch: "main",
  owner: { login: "acme" },
  node_id: "R_kgDO",
  stargazers_count: 12
};

export const githubPullRequestPayload = {
  number: 123,
  title: "Harden checkout totals",
  body: "Fixes rounding on tax calculation.",
  state: "open" as const,
  merged_at: null,
  html_url: "https://github.com/acme/payments/pull/123",
  created_at: "2026-08-31T08:00:00Z",
  updated_at: "2026-08-31T09:00:00Z",
  additions: 12,
  deletions: 4,
  changed_files: 2,
  user: {
    id: 42,
    login: "ada",
    avatar_url: "https://avatars.githubusercontent.com/u/42"
  },
  base: { ref: "main", sha: gitSha },
  head: { ref: "fix-tax", sha: headSha },
  node_id: "PR_kwDO",
  mergeable_state: "clean"
};

export const githubChangedFilePayload = {
  filename: "src/checkout/totals.ts",
  status: "modified",
  additions: 8,
  deletions: 3,
  patch: "@@ -1,3 +1,4 @@\n+export const tax = 1;\n",
  sha: gitSha,
  blob_url: "https://github.com/acme/payments/blob/main/src/checkout/totals.ts"
};

export const githubFileContentPayload = {
  type: "file",
  path: "src/index.ts",
  sha: gitSha,
  size: 12,
  encoding: "base64",
  content: Buffer.from("export {};\n", "utf8").toString("base64"),
  html_url: "https://github.com/acme/payments/blob/main/src/index.ts"
};

export const githubCommitPayload = {
  sha: gitSha,
  html_url: `https://github.com/acme/payments/commit/${gitSha}`,
  node_id: "C_kwDO",
  commit: {
    message: "Harden checkout totals",
    author: {
      name: "Ada",
      email: "ada@example.com",
      date: "2026-08-31T09:00:00Z"
    }
  },
  parents: [{ sha: headSha }]
};

export const githubInlineCommentPayload = {
  id: 901,
  user: {
    id: 42,
    login: "ada",
    avatar_url: "https://avatars.githubusercontent.com/u/42"
  },
  body: "This rounding will undercharge tax.",
  created_at: "2026-08-31T09:05:00Z",
  updated_at: "2026-08-31T09:06:00Z",
  html_url: "https://github.com/acme/payments/pull/123#discussion_r901",
  path: "src/checkout/totals.ts",
  line: 48,
  commit_id: gitSha,
  node_id: "PRRC_kwDO"
};

export const githubConversationCommentPayload = {
  id: 902,
  user: { id: 7, login: "grace" },
  body: "Please add a regression test.",
  created_at: "2026-08-31T09:07:00Z",
  updated_at: "2026-08-31T09:07:00Z",
  html_url: "https://github.com/acme/payments/pull/123#issuecomment-902",
  node_id: "IC_kwDO"
};

export const jsonResponse = (
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {}
): Response =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "4999",
      "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
      ...init.headers
    }
  });

export const createFetchMock = (
  handler: (url: URL, init: RequestInit) => Response | Promise<Response>
) => {
  const calls: { url: URL; init: RequestInit }[] = [];

  const fetchMock: typeof fetch = async (input, init = {}) => {
    const url =
      typeof input === "string"
        ? new URL(input)
        : input instanceof URL
          ? input
          : new URL(input.url);

    calls.push({ url, init });
    return handler(url, init);
  };

  return { fetchMock, calls };
};

export const createMemorySecrets = (values: Record<string, string>) => ({
  async get(key: string): Promise<string | null> {
    return values[key] ?? null;
  }
});
