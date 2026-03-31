import { describe, expect, it } from "bun:test";

import {
  editSessionCommitModeValues,
  type EditSessionCommitPolicy,
  type EditSessionController,
  type EditSessionFieldController,
} from "./index.js";

describe("edit-session contracts", () => {
  it("exposes the supported commit-policy modes through the public surface", () => {
    const policies = {
      blur: { mode: "blur" },
      debounce: { delayMs: 250, mode: "debounce" },
      immediate: { mode: "immediate" },
      submit: { mode: "submit" },
    } satisfies Record<string, EditSessionCommitPolicy>;

    expect(editSessionCommitModeValues).toEqual(["immediate", "blur", "debounce", "submit"]);
    expect(policies).toEqual({
      blur: { mode: "blur" },
      debounce: { delayMs: 250, mode: "debounce" },
      immediate: { mode: "immediate" },
      submit: { mode: "submit" },
    });
  });

  it("lets hosts model field and session controllers over the same draft boundary", () => {
    let fieldSnapshot = {
      committedValue: "Draft item",
      draftValue: "Draft item",
      dirty: false,
      touched: false,
    };
    let sessionSnapshot = {
      committedValue: { name: fieldSnapshot.committedValue },
      draftValue: { name: fieldSnapshot.draftValue },
      dirty: fieldSnapshot.dirty,
      touched: fieldSnapshot.touched,
    };
    const fieldListeners = new Set<() => void>();
    const sessionListeners = new Set<() => void>();

    function syncSessionSnapshot() {
      sessionSnapshot = {
        committedValue: { name: fieldSnapshot.committedValue },
        draftValue: { name: fieldSnapshot.draftValue },
        dirty: fieldSnapshot.dirty,
        touched: fieldSnapshot.touched,
      };
    }

    function notify() {
      fieldListeners.forEach((listener) => listener());
      sessionListeners.forEach((listener) => listener());
    }

    function updateField(nextSnapshot: typeof fieldSnapshot) {
      fieldSnapshot = nextSnapshot;
      syncSessionSnapshot();
      notify();
    }

    const fieldController = {
      commitPolicy: { mode: "blur" },
      path: ["name"] as const,
      commit() {
        if (!fieldSnapshot.dirty) return false;
        updateField({
          ...fieldSnapshot,
          committedValue: fieldSnapshot.draftValue,
          dirty: false,
        });
        return true;
      },
      getSnapshot() {
        return fieldSnapshot;
      },
      revert() {
        if (!fieldSnapshot.dirty) return false;
        updateField({
          ...fieldSnapshot,
          draftValue: fieldSnapshot.committedValue,
          dirty: false,
        });
        return true;
      },
      setDraftValue(nextValue: string) {
        updateField({
          ...fieldSnapshot,
          draftValue: nextValue,
          dirty: nextValue !== fieldSnapshot.committedValue,
        });
      },
      setTouched(nextTouched: boolean) {
        if (fieldSnapshot.touched === nextTouched) return;
        updateField({
          ...fieldSnapshot,
          touched: nextTouched,
        });
      },
      subscribe(listener: () => void) {
        fieldListeners.add(listener);
        return () => {
          fieldListeners.delete(listener);
        };
      },
    } satisfies EditSessionFieldController<string, readonly ["name"]>;

    const sessionController = {
      commit() {
        return fieldController.commit();
      },
      defaultCommitPolicy: { mode: "submit" },
      getField(path: readonly string[]) {
        return path.join(".") === "name" ? fieldController : undefined;
      },
      getSnapshot() {
        return sessionSnapshot;
      },
      revert() {
        return fieldController.revert();
      },
      setDraftValue(nextValue: { name: string }) {
        fieldController.setDraftValue(nextValue.name);
      },
      setTouched(nextTouched: boolean) {
        fieldController.setTouched(nextTouched);
      },
      subscribe(listener: () => void) {
        sessionListeners.add(listener);
        return () => {
          sessionListeners.delete(listener);
        };
      },
    } satisfies EditSessionController<{ name: string }>;

    let fieldUpdates = 0;
    let sessionUpdates = 0;
    const unsubscribeField = fieldController.subscribe(() => {
      fieldUpdates += 1;
    });
    const unsubscribeSession = sessionController.subscribe(() => {
      sessionUpdates += 1;
    });

    expect(sessionController.defaultCommitPolicy).toEqual({ mode: "submit" });
    expect(fieldController.commitPolicy).toEqual({ mode: "blur" });

    sessionController.setDraftValue({ name: "Renamed item" });

    expect(sessionController.getField(["name"])).toBe(fieldController);
    expect(fieldController.getSnapshot()).toMatchObject({
      committedValue: "Draft item",
      dirty: true,
      draftValue: "Renamed item",
      touched: false,
    });
    expect(fieldUpdates).toBe(1);
    expect(sessionUpdates).toBe(1);

    fieldController.setTouched(true);

    expect(sessionController.getSnapshot()).toMatchObject({
      dirty: true,
      touched: true,
    });
    expect(fieldUpdates).toBe(2);
    expect(sessionUpdates).toBe(2);

    expect(sessionController.commit()).toBe(true);
    expect(sessionController.getSnapshot()).toMatchObject({
      committedValue: { name: "Renamed item" },
      draftValue: { name: "Renamed item" },
      dirty: false,
      touched: true,
    });

    fieldController.setDraftValue("Temporary item");
    expect(fieldController.revert()).toBe(true);
    expect(sessionController.getSnapshot()).toMatchObject({
      committedValue: { name: "Renamed item" },
      draftValue: { name: "Renamed item" },
      dirty: false,
      touched: true,
    });

    unsubscribeField();
    unsubscribeSession();
  });
});
