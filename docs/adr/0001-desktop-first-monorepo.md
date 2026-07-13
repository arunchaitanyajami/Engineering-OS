# ADR-0001: Modular Monorepo Architecture

## Status

Accepted

## Context

Engineering OS needs to support desktop-native workflows, local memory, plugin connectors, reusable agents, and future automation without collapsing everything into one tightly coupled application.

## Decision

Use a `pnpm` monorepo with:

- `apps/desktop` as the primary product surface
- `apps/cli` as the secondary automation and developer surface
- shared packages for runtime, workflow, memory, configuration, UI, and security
- plugins as separate connector modules
- agents as distinct role-specific modules
- workflows as reusable execution units

## Alternatives Considered

- single repository without workspace boundaries
- separate repositories per subsystem
- web-first application structure

## Consequences

- early setup work is higher
- boundaries are clearer for future contributors
- plugin and workflow development can progress independently

## Risks

- teams can over-split packages too early
- cross-package tooling can become noisy if conventions drift

## Revisit Conditions

- revisit if the workspace structure starts blocking release velocity more than it protects architecture
