# Example MCP Plugin

Internal reference plugin for Milestone 2 MCP gateway validation.

## Tools

| Tool                         | Description                                                   |
| ---------------------------- | ------------------------------------------------------------- |
| `echo`                       | Returns the supplied message unchanged                        |
| `get_current_workspace_info` | Returns safe process metadata (`cwd`, Node version, platform) |
| `list_sample_resources`      | Lists bundled sample resources                                |
| `read_sample_resource`       | Reads a sample resource by URI                                |
| `crash_server`               | Simulates one MCP process crash, then reports recovery        |

## Sample resources

- `sample://docs/getting-started`
- `sample://docs/plugin-overview`

This plugin intentionally excludes GitHub or other Milestone 3 connectors.

## Architecture

- `dist/backend/index.js` — plugin lifecycle hooks
- `dist/mcp/server.js` — stdio MCP server started by the gateway

The backend does not spawn MCP processes directly. After enabling the plugin, start the MCP registration from the MCP Servers screen or lifecycle API.

`crash_server` is a deliberate exit-demo fixture. It exits once, allowing the
gateway to demonstrate crash isolation, restart counting, structured
diagnostics, and recovery without terminating the desktop backend.

## Install locally

From the desktop **Plugins** screen, click **Browse…** to choose this directory, or paste its absolute path, then register the package. Grant permissions, enable the plugin, and start the `example` MCP server registration.

## Dependencies

Reference plugins ship as plain JavaScript entrypoints and do not bundle workspace packages. Author against `@engineering-os/contracts` and `@engineering-os/plugin-sdk` in your own development environment.

Do not run `pnpm install` inside a plugin package directory before registering it locally — the registry rejects packages that contain `node_modules` symbolic links.
