# GitHub Plugin

Workspace-scoped GitHub connector for Milestone 3.

GitHub REST knowledge stays in this package. Application services, agents, and
the desktop UI must consume normalized `@engineering-os/source-control-domain`
types through the MCP gateway once those tools land.

## Current scope (M3.2)

- personal access token authentication, with OAuth and GitHub App method shapes reserved
- credential resolution through plugin secret references (never raw tokens in SQLite)
- GitHub client adapter: repositories, pull requests, files, file content, commits
- typed errors, pagination, and rate-limit metadata
- mapping from GitHub REST payloads onto domain contracts

MCP tools, connection UI, and review publishing are later Milestone 3 phases.

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
