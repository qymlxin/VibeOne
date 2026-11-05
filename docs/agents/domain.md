# Domain docs

## Layout

This project uses a single-context layout:

- Root `GLOSSARY.md`: domain terminology.
- `docs/adr/`: architecture decision records.

## Reading rules

Before exploring domain code, read the existing glossary and ADRs relevant to the task.

If these files do not exist, proceed silently. The domain-modeling skill creates
them as needed when terms or decisions are actually resolved.

## Terminology and decisions

Use the glossary's terminology in issues, specs, code, and reviews.

When a concept appears to be missing, check existing terminology first.
Refer confirmed gaps to domain-modeling.

When proposing a change that conflicts with an existing ADR,
identify the ADR and explain the reason for the change and its impact.
