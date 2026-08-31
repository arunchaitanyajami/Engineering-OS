export const githubPluginId = "com.engineering-os.github";

export const githubPluginCapabilities = {
  repositoriesRead: "repositories.read",
  contentsRead: "contents.read",
  pullRequestsRead: "pullRequests.read",
  pullRequestsReview: "pullRequests.review"
} as const;

export type GitHubPluginCapability =
  (typeof githubPluginCapabilities)[keyof typeof githubPluginCapabilities];

export const githubApiHost = "api.github.com";
