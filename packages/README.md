# Packages

Shared runtime, SDK, and platform packages live here.

Milestone 0 packages:

- `core`
- `contracts`
- `shared`
- `config`
- `logger`
- `database`
- `platform`
- `security`
- `events`
- `ui`
- `testing`
- `tsconfig`

Milestone 2 introduces `contracts` as the stable cross-package boundary for plugin manifest, permission declaration, compatibility, and bundled MCP declaration types.

Runtime, SDK, tool-execution, and RPC contracts remain explicitly unstable behind the `@engineering-os/contracts/unstable-runtime` entrypoint until their milestone phases are implemented.

Future milestone packages such as `plugin-sdk`, `mcp-gateway`, `memory`, and `workflow-engine` will be added when they gain a concrete responsibility and milestone owner.
