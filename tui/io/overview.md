# TUI Overview

## Purpose

`tui` renders the operator-facing session UI for IO runs on top of the retained runtime and normalized event stream produced by `agent`.

## Docs

- `../../agent/io/overview.md`
- `../../agent/io/module-stream-workflow-plan.md`

## Layout

- `../src/store.ts`: retained session state model
- `../src/transcript.ts`: transcript shaping and formatting
- `../src/tui.tsx`: UI composition
- `../src/layout.ts`, `../src/session-events.ts`, `../src/codex-event-stream.ts`: rendering support
- `../src/tui.test.ts`: UI/runtime regression coverage
