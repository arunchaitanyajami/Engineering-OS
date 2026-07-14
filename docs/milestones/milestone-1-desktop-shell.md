# Milestone 1: Desktop Shell

## Purpose

Establish the production-quality desktop shell that every later Engineering OS
capability builds on.

## Architecture Summary

- `apps/desktop` owns the Tauri shell, routed React workspace, and native
  command boundary.
- `packages/config` owns typed settings, defaults, schema versioning, and
  migration helpers.
- `packages/platform` owns the desktop platform contract and test doubles.
- `packages/ui` provides shell-focused primitives for navigation, status,
  loading, and empty states.

## Milestone Boundaries

- Included: desktop layout, navigation, initialization lifecycle, command
  palette foundation, theme persistence, settings infrastructure, and Tauri
  command scoping.
- Deferred: plugins, MCP gateway, enterprise connectors, AI providers,
  workflows, and multi-agent execution.

## Tradeoffs

- Settings are isolated behind a config service so the storage backend can
  evolve without rewriting feature code.
- The desktop platform abstraction adds indirection, but it keeps the shell
  testable and prevents Tauri coupling from leaking into React features.
- SQLite remains a documented foundation decision, while Milestone 1 focuses on
  the shell and typed status modeling first.
