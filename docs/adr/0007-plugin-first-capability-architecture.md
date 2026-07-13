# ADR-0007: Plugin-First Capability Architecture

## Status

Accepted

## Context

The platform must integrate many systems over time without coupling connector code into the core runtime.

## Decision

Treat every external integration as a plugin and let workflows and agents depend on capabilities instead of connector implementations.

## Alternatives Considered

- built-in connectors in core packages
- agent-owned integration logic

## Consequences

- plugins stay independently installable and removable
- the platform can enforce permissions at a consistent boundary

## Risks

- plugin contracts must stay small and stable

## Revisit Conditions

- revisit only if plugin boundaries create unacceptable operational overhead
