# ADR-0012: Testing and CI Quality Strategy

## Status

Accepted

## Context

Engineering OS needs strong quality gates because later milestones will add security-sensitive connectors, agents, and automated actions.

## Decision

Use Vitest for unit and integration tests, Playwright for end-to-end smoke coverage, and GitHub Actions for mandatory pull-request validation.

## Alternatives Considered

- manual verification only
- heavier enterprise CI systems before open-source readiness

## Consequences

- quality gates exist before feature complexity grows
- contributors get one documented validation path through `pnpm check`

## Risks

- native desktop and Playwright coverage may need separate optimization later

## Revisit Conditions

- revisit when desktop automation needs exceed browser-based smoke coverage
