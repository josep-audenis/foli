# ADR-0001: Editor foundation

- **Status:** Superseded by [ADR-0002](ADR-0002-own-editing-engine.md) (2026-11-04)
- **Date:** 2026-11-04

## Context

Foli needs selection, IME, transactions, undo and clipboard so effort can go to the
differentiator: paginated, Word-like document editing. A single continuous document must be
shown as multiple pages without fragmenting selection, undo history or the document model (see
[pagination.md](../pagination.md)).

## Decision

Build on an existing third-party editor engine (MIT packages only) and implement pagination on
top of it.

## Consequences

Superseded the same day by [ADR-0002](ADR-0002-own-editing-engine.md): the engine would have
supplied the model, transactions, schema and extension system, so removing it later would mean
rewriting nearly everything. Foli owns its engine instead.
