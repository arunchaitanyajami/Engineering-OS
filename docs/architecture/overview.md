# Architecture Overview

## Purpose

Engineering OS is a desktop-first, AI-native engineering platform for engineers who need one local workspace to query knowledge, run agent workflows, and connect enterprise systems through plugins.

## Core Decisions

- Desktop is the primary product surface.
- Local storage is the default for config, memory, and indexed context.
- MCP is the preferred connector protocol.
- Every connector is a plugin.
- Agents are specialized and composable.
- Workflows coordinate tool use, agent collaboration, and approvals.
- Model providers remain swappable behind a stable abstraction.

## High-Level Architecture

```text
desktop app
  -> ui package
  -> core runtime
  -> config, logger, database, security, events
  -> future model provider abstraction
  -> future workflow engine
  -> future memory package
  -> future mcp gateway
  -> future plugin sdk
  -> future plugins
  -> future agents
```

## Monorepo Boundaries

- `apps/desktop`: Tauri desktop shell and React UI.
- `apps/cli`: automation and developer-facing command-line entrypoint.
- `packages/core`: runtime orchestration and application services.
- `packages/shared`: foundational identifiers, results, and utility types.
- `packages/ui`: shared design system and desktop UI primitives.
- `packages/security`: permission handling, secret boundaries, and audit logging contracts.
- `packages/config`: local configuration loading and validation.
- `packages/logger`: structured logging and redaction.
- `packages/database`: SQLite lifecycle and migrations.
- `packages/events`: in-process typed event bus.
- `packages/testing`: shared testing fixtures and helpers.
- `plugins/*`: independently installable connectors.
- `agents/*`: specialized engineering agents.
- `workflows/*`: reusable engineering workflows.

## First MVP Flow

1. User opens the desktop app.
2. User connects GitHub through a plugin.
3. User asks `Review PR 123`.
4. The workflow fetches repository, PR metadata, changed files, and diff.
5. The PR Reviewer agent returns a structured review.

## Milestone 0 Constraints

- No production connector implementation yet.
- No production agent logic yet.
- No action automation yet.
- Only the project foundation, docs, and starter shells are required.
