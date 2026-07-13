# Container Architecture

## Containers

### Desktop App

- built with Tauri v2, React, TypeScript, and Vite
- owns the user experience and typed command boundary
- never talks directly to SQLite, secrets, provider SDKs, or MCP servers

### Application Service Layer

- runs in TypeScript behind the Tauri boundary
- owns orchestration, plugin lifecycle, capability registration, agent definitions, workflow definitions, storage, and security enforcement

### Foundation Packages

- `packages/core`: platform contracts and orchestration interfaces
- `packages/shared`: shared primitives such as branded identifiers and results
- `packages/config`: validated runtime configuration and feature flags
- `packages/logger`: structured logging with redaction
- `packages/database`: SQLite lifecycle, migrations, and audit persistence
- `packages/security`: permissions, secret store abstraction, confirmation policy, and audit contracts
- `packages/events`: typed in-process event bus
- `packages/ui`: reusable UI primitives and design tokens
- `packages/testing`: shared test helpers

### Future Containers

- plugins
- MCP gateway
- workflow engine
- specialized agents
- vector memory services
