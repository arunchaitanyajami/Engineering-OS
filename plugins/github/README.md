# GitHub Plugin

Workspace-scoped GitHub connector for Milestone 3.

GitHub REST knowledge stays in this package. Application services, agents, and
the desktop UI must consume normalized `@engineering-os/source-control-domain`
types through the MCP gateway once those tools land.

## Current scope (M3.3)

- personal access token authentication, with OAuth and GitHub App method shapes reserved
- credential resolution through plugin secret references (never raw tokens in SQLite)
- GitHub client adapter: repositories, pull requests, files, file content, commits, comments
- typed errors, pagination, and rate-limit metadata
- mapping from GitHub REST payloads onto domain contracts
- read-only MCP tools with workspace and connection isolation

Publishing and connection UI are later Milestone 3 phases.

## MCP tools

| Tool                               | Capability          |
| ---------------------------------- | ------------------- |
| `github.list_repositories`         | `repositories.read` |
| `github.list_pull_requests`        | `pullRequests.read` |
| `github.get_pull_request`          | `pullRequests.read` |
| `github.get_pull_request_files`    | `pullRequests.read` |
| `github.get_file_content`          | `contents.read`     |
| `github.get_commit`                | `contents.read`     |
| `github.get_pull_request_comments` | `pullRequests.read` |

## Identity

| Field                   | Value                       |
| ----------------------- | --------------------------- |
| Plugin ID               | `com.engineering-os.github` |
| Source-control provider | `github`                    |

## Secrets

SQLite and connection records may store a `credentialRef`. The actual token is
read from `context.secrets` using that reference.

Do not log credentials. Do not return credentials from client methods.

## Local registration

Workspace TypeScript path aliases resolve `@engineering-os/contracts`,
`@engineering-os/plugin-sdk`, and `@engineering-os/source-control-domain`.
This package does not declare those as `package.json` dependencies so a
local desktop install is not blocked by `node_modules` symbolic links.
