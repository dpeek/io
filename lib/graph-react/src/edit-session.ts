// Ordered from most eager to most deferred so docs and tests can share one
// canonical list of supported commit modes.
export const editSessionCommitModeValues = ["immediate", "blur", "debounce", "submit"] as const;

export type EditSessionCommitMode = (typeof editSessionCommitModeValues)[number];

/**
 * Descriptive commit-policy metadata for edit-session hosts.
 *
 * The shared runtime does not schedule `commit()` itself. Renderers and host
 * surfaces interpret this policy to decide when draft changes should become
 * committed values.
 */
export type EditSessionCommitPolicy =
  | {
      mode: "immediate" | "blur" | "submit";
    }
  | {
      mode: "debounce";
      delayMs: number;
    };

export type EditSessionListener = () => void;
export type EditSessionPath = readonly string[];

export type EditControllerSnapshot<Value> = {
  committedValue: Value;
  draftValue: Value;
  dirty: boolean;
  touched: boolean;
};

export type EditSessionSnapshot<Value> = EditControllerSnapshot<Value>;
export type EditSessionFieldSnapshot<Value> = EditControllerSnapshot<Value>;

export type EditController<
  Value,
  Snapshot extends EditControllerSnapshot<Value> = EditControllerSnapshot<Value>,
> = {
  getSnapshot(): Snapshot;
  setDraftValue(nextValue: Value): void;
  setTouched(nextTouched: boolean): void;
  subscribe(listener: EditSessionListener): () => void;
  commit(): boolean;
  revert(): boolean;
};

export type EditSessionFieldController<
  Value,
  Path extends EditSessionPath = EditSessionPath,
> = EditController<Value, EditSessionFieldSnapshot<Value>> & {
  path: Path;
  // Field-level override for the surrounding session default, when present.
  commitPolicy?: EditSessionCommitPolicy;
};

export type EditSessionController<
  Value,
  Path extends EditSessionPath = EditSessionPath,
> = EditController<Value, EditSessionSnapshot<Value>> & {
  // Host-selected fallback commit policy when a field does not override it.
  defaultCommitPolicy?: EditSessionCommitPolicy;
  getField(path: Path): EditSessionFieldController<unknown, Path> | undefined;
};
