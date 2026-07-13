# Frontend And Backend Boundary

## Boundary Model

```text
React UI
  -> typed application client
  -> Tauri command boundary
  -> application services
  -> core, plugins, database, security, MCP
```

## Forbidden Frontend Access

- SQLite
- file system and operating system APIs
- secrets and credentials
- MCP servers
- AI provider SDKs
- connector credentials

## Why

- keeps secrets local and protected
- prevents UI code from hardcoding infrastructure concerns
- makes backend contracts testable and replaceable
