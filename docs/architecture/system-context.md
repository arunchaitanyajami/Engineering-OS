# System Context

## Purpose

Engineering OS is a local engineering workspace that combines desktop UX, local data, plugins, MCP connectors, agents, workflows, and security controls in one platform.

## Context Diagram

```text
engineer
  -> Engineering OS desktop app
    -> local application services
      -> SQLite
      -> future LanceDB
      -> local secret storage abstraction
      -> plugins
      -> MCP gateway
      -> agents
      -> workflows
```

## External Actors

- engineer: uses the desktop application and approves dangerous actions
- plugins: extend the platform through isolated contracts
- MCP servers: expose tools, resources, and prompts through a standard gateway
- model providers: remain behind provider-independent abstractions

## Milestone 0 Boundary

- the desktop shell exists
- local configuration, logging, database, audit, and event foundations exist
- no production connectors or provider integrations exist yet
