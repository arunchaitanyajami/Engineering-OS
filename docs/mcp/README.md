# MCP Documentation

Documentation for Model Context Protocol integration in Engineering OS.

## Start here

- [MCP architecture](../architecture/mcp-architecture.md)
- [MCP-first integration ADR](../adr/0006-mcp-first-integration.md)
- [MCP gateway single boundary ADR](../adr/0019-mcp-gateway-single-boundary.md)
- [MCP runtime failure policy](../adr/0024-mcp-runtime-failure-and-trusted-command-policy.md)

## Packages

| Package | Responsibility |
| --- | --- |
| `@engineering-os/mcp-gateway` | Server registration, discovery, execution, and policy enforcement |
| `@engineering-os/mcp-client` | Client session and connection abstractions |
| `@engineering-os/capability-catalog` | Normalized tool, resource, and prompt catalog types |

## Reference plugin

- [`plugins/example-mcp-plugin`](../../plugins/example-mcp-plugin/README.md)

## Desktop surfaces

- MCP server management: `/mcp/servers`
- Tool test console: `/mcp/tool-console`
