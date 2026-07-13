# MCP Architecture

## Decision

Engineering OS treats MCP as the preferred integration layer for external tools, resources, and prompts.

## Milestone 0 Scope

- define MCP-first as a platform rule
- do not implement a production gateway yet
- ensure connectors can be introduced later without changing core contracts

## Responsibilities

- plugins expose capabilities to the platform
- the future MCP gateway normalizes tools, resources, and prompts
- workflows and agents depend on capabilities, not connector internals

## Benefits

- provider and connector independence
- consistent integration model across vendors
- easier testing and local-first execution
