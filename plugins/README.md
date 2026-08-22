# Plugins

Connector plugins live here.

## Reference plugins (Milestone 2)

- [`example-plugin/`](./example-plugin/README.md) — lifecycle, configuration, secrets, logging, and failure handling
- [`example-mcp-plugin/`](./example-mcp-plugin/README.md) — safe local MCP tools for gateway validation

## Planned connector surfaces

- `github`
- `jira`
- `confluence`
- `google-drive`
- `gmail`
- `microsoft-graph`
- `slack`
- `filesystem`
- `postgres`
- `docker`

## Dependency rules

Plugins are independently installable, removable, testable, and permission-aware.

Each plugin package may depend only on:

- `@engineering-os/contracts`
- `@engineering-os/plugin-sdk`

See [dependency rules](../docs/architecture/dependency-rules.md) and [plugin development](../docs/plugins/README.md).
