# TUI Overview

## Purpose

The agent-owned TUI renders the operator-facing session UI for IO runs on top of
the retained runtime and normalized event stream produced by `agent`.

## Docs

- `../../agent/io/overview.md`
- `../../agent/io/module-stream-workflow-plan.md`

## Layout

- `../src/tui/store.ts`: retained session state model
- `../src/tui/transcript.ts`: transcript shaping and formatting
- `../src/tui/tui.tsx`: UI composition
- `../src/tui/layout.ts`, `../src/tui/session-events.ts`, `../src/tui/codex-event-stream.ts`: rendering support
- `../src/tui/ui.test.ts`: UI/runtime regression coverage
