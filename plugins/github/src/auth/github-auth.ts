import { z } from "zod";

export const githubAuthMethodSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("oauth"),
      accessTokenRef: z.string().trim().min(1).max(256)
    })
    .strict(),
  z
    .object({
      type: z.literal("personal-access-token"),
      tokenRef: z.string().trim().min(1).max(256)
    })
    .strict(),
  z
    .object({
      type: z.literal("github-app"),
      installationId: z.string().trim().min(1).max(128),
      credentialRef: z.string().trim().min(1).max(256)
    })
    .strict()
]);

export type GitHubAuthMethod = z.infer<typeof githubAuthMethodSchema>;

export interface GitHubResolvedAuth {
  readonly type: "token";
  readonly token: string;
}

export const githubMcpWorkspaceIdEnvKey = "ENGINEERING_OS_WORKSPACE_ID";

export const githubPatSecretKey = (input: {
  readonly workspaceId: string;
  readonly connectionId: string;
}): string =>
  `workspace.${input.workspaceId}.connection.${input.connectionId}.pat`;

export const githubMcpSecretEnvKey = (secretKey: string): string =>
  `ENGINEERING_OS_SECRET_${secretKey
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase()}`;

export const secretKeyForAuthMethod = (method: GitHubAuthMethod): string => {
  switch (method.type) {
    case "personal-access-token":
      return method.tokenRef;
    case "oauth":
      return method.accessTokenRef;
    case "github-app":
      return method.credentialRef;
  }
};
