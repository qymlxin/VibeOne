## Agent skills

### Issue tracker

Track issues in local Markdown. Before creating, reading, or updating issues, read `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage labels. Before triaging issues, read `docs/agents/triage-labels.md`.

### Domain docs

Use a single-context layout. Before exploring domain models or recording architecture decisions, read `docs/agents/domain.md`.

## Documentation language

Write functional design documents in Simplified Chinese. Preserve code identifiers, protocol names, and links; explain domain terms in Chinese on first use. Keep agent configuration documents in English.

## UI delivery

For every UI-affecting feature, including small additions, define the layout, hierarchy, styling, and interaction states before implementation. Use the approved prototype code and established visual language. Deliver the designed interface with the feature, including light/dark mode, loading, empty, error, and keyboard-focus states. Inspect the rendered result and use focused checks; do not add a separate user approval gate or run broad regressions for routine UI changes.
