# Issue tracker: Local Markdown

Issues and specs live in this project's `.scratch/` directory.

## File conventions

- Use one directory per feature: `.scratch/<feature-slug>/`.
- Store the spec at `.scratch/<feature-slug>/spec.md`.
- Store each issue in its own file:
  `.scratch/<feature-slug>/issues/<NN>-<slug>.md`.
- Start numbering at `01`.
- Record triage state in a `Status:` line near the top of each issue.
  See `triage-labels.md` for label meanings.
- Append comments and discussion under `## Comments` at the end of the file.

## Publishing and reading issues

When a skill says to publish to the issue tracker, create a file using the conventions above.

When a skill says to fetch an issue, read the path supplied by the user.
When looking up an issue by number, resolve it within the relevant feature directory.

## Wayfinder

- Map: `.scratch/<effort>/map.md`, containing Notes, Decisions-so-far, and Fog.
- Child ticket: `.scratch/<effort>/issues/NN-<slug>.md`.
- Record the ticket type as `Type: research`, `prototype`, `grilling`, or `task`.
- Record dependencies as `Blocked by: NN, NN`.
  A ticket is unblocked when all its dependencies are resolved.
- Select unresolved, unclaimed, unblocked tickets in numerical order.
- Before starting work, save `Status: claimed`.
- On completion, append `## Answer`, save `Status: resolved`,
  and add a summary and ticket link to Decisions-so-far in the map.

Wayfinder execution states and ordinary issue triage labels follow their respective conventions.
