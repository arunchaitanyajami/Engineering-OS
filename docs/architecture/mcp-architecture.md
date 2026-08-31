# MCP Architecture

## Decision

Engineering OS treats MCP as the preferred integration layer for external tools, resources, and prompts.

## Responsibilities

- `@engineering-os/mcp-gateway` is the single MCP client boundary.
- Plugin-owned and user-registered servers use the managed `stdio` transport.
- The gateway owns server registration, lifecycle, startup deadlines, capability
  discovery, normalized catalogs, tool validation, execution, and health.
- Plugins expose capabilities to the platform; workflows and agents consume
  provider-independent tools, resources, and prompts.
- Permission checks and audit events run before privileged tool execution.

## Runtime behavior

The gateway supervises each MCP child process, captures process output, detects
unexpected exits, records restart counts, and exposes normalized diagnostics.
Startup, discovery, and tool execution have bounded timeouts. Server commands
are constrained to trusted plugin-owned or explicitly registered local
commands.

Health snapshots include the server registration, process identifier while
running, discovery state, startup duration, restart count, current health state,
and the last normalized error.

## Developer boundary

MCP SDK types remain inside the gateway implementation. Consumers use the
contracts exported by `@engineering-os/contracts/unstable-runtime` and the
gateway APIs rather than connecting to an MCP server directly.

## Benefits

- provider and connector independence
- consistent integration model across vendors
- easier testing and local-first execution
