import {
  changedFileSchema,
  type ChangedFile,
  type ChangedFileStatus
} from "@engineering-os/source-control-domain";

import {
  githubPullRequestFilePayloadSchema,
  type GitHubPullRequestFilePayload
} from "../github-api/payloads.js";
import { mapGitHubPayload } from "./mapping.js";

const languageByExtension: Readonly<Record<string, string>> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  go: "Go",
  rs: "Rust",
  java: "Java",
  rb: "Ruby",
  md: "Markdown",
  json: "JSON",
  yml: "YAML",
  yaml: "YAML",
  css: "CSS",
  html: "HTML",
  sh: "Shell",
  sql: "SQL"
};

const detectLanguage = (path: string): string | undefined => {
  const extension = path.split(".").pop()?.toLowerCase();

  if (!extension || extension === path.toLowerCase()) {
    return undefined;
  }

  return languageByExtension[extension];
};

const toChangedFileStatus = (status: string): ChangedFileStatus => {
  switch (status) {
    case "added":
    case "copied":
      return "added";
    case "removed":
      return "deleted";
    case "renamed":
      return "renamed";
    default:
      return "modified";
  }
};

export const mapChangedFile = (payload: unknown): ChangedFile =>
  mapGitHubPayload("changed file", () => {
    const file = githubPullRequestFilePayloadSchema.parse(payload);
    return changedFileSchema.parse(toChangedFile(file));
  });

const toChangedFile = (payload: GitHubPullRequestFilePayload): ChangedFile => {
  const status = toChangedFileStatus(payload.status);
  const language = detectLanguage(payload.filename);
  const binary = payload.patch === undefined && status !== "deleted";

  return {
    path: payload.filename,
    ...(payload.previous_filename
      ? { previousPath: payload.previous_filename }
      : {}),
    status,
    additions: payload.additions,
    deletions: payload.deletions,
    ...(payload.patch === undefined ? {} : { patch: payload.patch }),
    binary,
    ...(language ? { language } : {})
  };
};
