# Plugin Development Overview

## Intent

Plugins are the only supported way to integrate external systems into Engineering OS.

## Requirements

- independently installable
- independently removable
- permission aware
- testable in isolation
- MCP compatible where possible

## Shipped Building Blocks

- `engineering-os.plugin.json` manifest and runtime validation
- local package discovery, compatibility checks, and SQLite registry
- capability-based permission grants and namespaced secrets
- out-of-process Node runtime with versioned RPC
- plugin lifecycle hooks: `initialize`, `activate`, `deactivate`, and `dispose`
- MCP server registration through the Engineering OS gateway

Plugins are not imported into the desktop process. A managed installation is
started only after the package has been inspected, validated, and enabled. The
backend supervises the child process, exposes health and restart diagnostics,
and stops it before disable or uninstall.

## Package Layout

Every plugin declares a backend entrypoint, normally
`dist/backend/index.js`, in `engineering-os.plugin.json`. MCP-enabled plugins
declare `stdio` servers in the manifest; those servers are started and accessed
through `@engineering-os/mcp-gateway`.

## Reference Path

Reference implementations are available in:

- `plugins/example-plugin`
- `plugins/example-mcp-plugin`

See their READMEs for local registration, permissions, lifecycle behavior, and
MCP tool examples.
