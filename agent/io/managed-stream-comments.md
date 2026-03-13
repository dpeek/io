# Legacy Managed Stream Comments

## Status

This document describes retained `@io` comment handling for the older
managed-stream automation. It is not the current default workflow surface. The
current backlog workflow is interactive and described in `../../io/backlog.md`.

## Historical Trigger Scope

Retained `@io` comments apply only to top-level comments on eligible top-level
stream issues.

Historical scope rules:

- direct child issues ignore `@io` commands
- one comment requests one command
- the first non-empty line is always the command line
- ineligible issues still receive a reply, but the result is blocked and no retained writes happen

## Historical Command Shape

The parser in `../src/managed-comments.ts` still expects a narrow line-plus-YAML form:

```md
@io <command>
docs:
  - ./agent/io/overview.md
dryRun: true
note: Refresh after the latest scope review
```

Accepted payload keys:

- `docs`
- `dryRun`
- `note`

Unknown commands, malformed YAML, or unknown top-level keys still turn into
parse-error replies rather than partial guessing.

## Historical Command Set

- `@io backlog`: may refresh the top-level stream description and sync speculative direct children
- `@io status`: reports the retained stream state without rewriting the issue body
- `@io help`: reports accepted commands and payload keys

`docs` can narrow or extend the doc list used for a retained refresh, and
`dryRun: true` computes the result without applying tracker writes.

## Historical Execution Model

`../src/service.ts` still handles retained comments by:

1. polling eligible top-level stream issues for top-level comments
2. parsing `@io` commands
3. checking whether the exact comment body hash was already handled
4. validating module identity
5. applying only the write surface allowed for that command
6. posting one reply comment and recording the handled comment state

Comment dedupe is retained in per-issue runtime files by `../src/comment-state.ts`.

## Historical Reply Shape

Reply comments still use one stable marker and a human-readable summary:

- `<!-- io-managed:comment-result -->`
- `Command: ...`
- `Result: ...`
- `Target: ...`
- bullet lines summarizing writes, no-ops, or warnings
