# ADR-0005: LanceDB for Future Local Vector Storage

## Status

Accepted

## Context

Engineering OS will need local semantic search and embeddings without making the core platform cloud-dependent.

## Decision

Reserve LanceDB as the preferred local vector store for future milestones.

## Alternatives Considered

- Chroma
- provider-hosted vector stores
- custom file-based vector indexes

## Consequences

- gives the roadmap a clear local-first direction for semantic memory
- avoids premature implementation during Milestone 0

## Risks

- future requirements may expose operational or ecosystem gaps

## Revisit Conditions

- revisit when Milestone 6 implementation starts and concrete benchmark data exists
