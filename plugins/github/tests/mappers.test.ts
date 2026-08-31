import { describe, expect, it } from "vitest";

import { mapChangedFile } from "../src/mappers/changed-file.mapper.js";
import { mapCommit, mapFileContent } from "../src/mappers/content.mapper.js";
import { mapPullRequest } from "../src/mappers/pull-request.mapper.js";
import { mapRepository } from "../src/mappers/repository.mapper.js";
import {
  gitSha,
  githubChangedFilePayload,
  githubCommitPayload,
  githubFileContentPayload,
  githubPullRequestPayload,
  githubRepositoryPayload
} from "./helpers.js";

describe("GitHub REST to domain mapping", () => {
  it("maps a repository and drops Octokit fields", () => {
    const repository = mapRepository(githubRepositoryPayload);

    expect(repository).toEqual({
      provider: "github",
      owner: "acme",
      name: "payments",
      fullName: "acme/payments",
      defaultBranch: "main",
      private: true,
      url: "https://github.com/acme/payments",
      description: "Payment services"
    });
    expect(repository).not.toHaveProperty("node_id");
    expect(repository).not.toHaveProperty("stargazers_count");
  });

  it("maps a merged pull request", () => {
    const pullRequest = mapPullRequest(
      {
        ...githubPullRequestPayload,
        state: "closed",
        merged_at: "2026-08-31T10:00:00Z"
      },
      { owner: "acme", name: "payments" }
    );

    expect(pullRequest.state).toBe("merged");
    expect(pullRequest.author.id).toBe("42");
    expect(pullRequest).not.toHaveProperty("mergeable_state");
    expect(pullRequest).not.toHaveProperty("node_id");
  });

  it("defaults list-payload change stats to zero", () => {
    const { additions, deletions, changed_files, ...listPayload } =
      githubPullRequestPayload;

    expect(additions).toBe(12);
    expect(deletions).toBe(4);
    expect(changed_files).toBe(2);

    const pullRequest = mapPullRequest(listPayload, {
      owner: "acme",
      name: "payments"
    });

    expect(pullRequest.additions).toBe(0);
    expect(pullRequest.deletions).toBe(0);
    expect(pullRequest.changedFiles).toBe(0);
  });

  it("maps renamed files and infers language from the path", () => {
    const file = mapChangedFile({
      ...githubChangedFilePayload,
      filename: "src/checkout/totals.ts",
      previous_filename: "src/checkout/sum.ts",
      status: "renamed"
    });

    expect(file.status).toBe("renamed");
    expect(file.previousPath).toBe("src/checkout/sum.ts");
    expect(file.language).toBe("TypeScript");
    expect(file).not.toHaveProperty("blob_url");
  });

  it("treats omitted patches as binary files", () => {
    const { patch: _patch, ...binaryPayload } = githubChangedFilePayload;

    expect(_patch).toBeDefined();
    expect(mapChangedFile(binaryPayload).binary).toBe(true);
  });

  it("decodes text file content and keeps binary content encoded", () => {
    const text = mapFileContent(githubFileContentPayload);
    expect(text).toMatchObject({
      encoding: "utf-8",
      content: "export {};\n",
      binary: false
    });

    const binary = mapFileContent({
      ...githubFileContentPayload,
      content: Buffer.from([0, 1, 2, 3]).toString("base64")
    });

    expect(binary.binary).toBe(true);
    expect(binary.encoding).toBe("base64");
  });

  it("maps a commit without GitHub node identifiers", () => {
    const commit = mapCommit(githubCommitPayload);

    expect(commit.sha).toBe(gitSha);
    expect(commit).not.toHaveProperty("node_id");
    expect(commit.parentShas).toEqual([
      "b2c3d4e5f6789012345678901234567890abcde1"
    ]);
  });
});
