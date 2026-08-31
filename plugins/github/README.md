# GitHub Plugin

Workspace-scoped GitHub connector for Milestone 3.

GitHub REST knowledge stays in this package. Application services, agents, and
the desktop UI must consume normalized `@engineering-os/source-control-domain`
types through the MCP gateway once those tools land.

## Current scope (M3.6)

- personal access token authentication, with OAuth and GitHub App method shapes reserved
- credential resolution through plugin secret references (never raw tokens in SQLite)
- GitHub client adapter: repositories, pull requests, files, file content, commits, comments
- typed errors, pagination, and rate-limit metadata
- mapping from GitHub REST payloads onto domain contracts
- read-only MCP tools with workspace and connection isolation
- workspace-scoped connection records and desktop connection UI
- repository and pull request browser through MCP only
- changed-file retrieval through MCP for the diff system

Publishing remains a later Milestone 3 phase.

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
read from `context.secrets` using that reference. Personal access tokens use a
workspace-scoped key:

`workspace.{workspaceId}.connection.{connectionId}.pat`

Do not log credentials. Do not return credentials from client methods.

## Local registration

This package is independently installable. The desktop registry loads JavaScript
entrypoints, not TypeScript:

- `dist/backend/index.js` — plugin lifecycle hooks
- `dist/mcp/server.js` — stdio MCP server started by the gateway

From this directory:

```bash
npm run build
```

That writes `dist/`. Do not run `npm install` / `pnpm install` inside this
folder. Workspace packages are bundled into `dist/mcp/server.js` so the
installed plugin does not need `node_modules`. The registry rejects plugin
packages that contain `node_modules` symbolic links.

`npm run typecheck` only type-checks (`tsc --noEmit`). It does not create
`dist/`.

After a successful build, register this directory from the desktop Plugins
screen.
