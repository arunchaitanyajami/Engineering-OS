# Plugin Development

Documentation for building Engineering OS connector plugins.

## Start here

- [Plugin development overview](../plugin-development/overview.md)
- [Plugin manifest ADR](../adr/0017-plugin-package-and-manifest-format.md)
- [Plugin SDK compatibility policy](../adr/0023-plugin-sdk-compatibility-policy.md)
- [Capability-based permissions](../adr/0020-capability-based-plugin-permissions.md)

## Reference packages

- `@engineering-os/contracts` — stable manifest and permission types
- `@engineering-os/plugin-sdk` — supported plugin author surface

## Reference plugins

- [`plugins/example-plugin`](../../plugins/example-plugin/README.md)
- [`plugins/example-mcp-plugin`](../../plugins/example-mcp-plugin/README.md)

## Rules

Plugins may depend only on `contracts` and `plugin-sdk`. They must not import desktop UI code, database packages, other plugin trees, or AI provider implementations.
