import { usePredicateField } from "@dpeek/graphle-react";
import { Alert, AlertDescription } from "@dpeek/graphle-web-ui/alert";
import { Button } from "@dpeek/graphle-web-ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@dpeek/graphle-web-ui/field";
import { Input } from "@dpeek/graphle-web-ui/input";
import { useEffect, useState } from "react";

import { secretFieldPlaintextRequiredMessage } from "../../lib/secret-fields.js";
import { formatTimestamp } from "./helpers.js";
import type {
  AnyPredicateRef,
  ExplorerRuntime,
  MutationCallbacks,
  SubmitSecretFieldMutation,
} from "./model.js";

export function SecretFieldEditor({
  callbacks,
  predicate,
  runtime,
  submitSecretField,
}: {
  callbacks: MutationCallbacks;
  predicate: AnyPredicateRef;
  runtime: ExplorerRuntime;
  submitSecretField: SubmitSecretFieldMutation;
}) {
  const { value } = usePredicateField(predicate);
  const secretId = typeof value === "string" ? value : undefined;
  const secret = secretId ? runtime.graph.secretHandle.get(secretId) : undefined;
  const [plaintext, setPlaintext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    setPlaintext("");
    setBusy(false);
    setError("");
    setStatus("");
  }, [predicate.predicateId, predicate.subjectId]);

  async function handleSubmit(): Promise<void> {
    const nextPlaintext = plaintext.trim();
    if (!nextPlaintext) {
      const nextError = secretFieldPlaintextRequiredMessage;
      setError(nextError);
      setStatus("");
      callbacks.onMutationError?.(new Error(nextError));
      return;
    }

    setBusy(true);
    setError("");
    setStatus("");

    try {
      const result = await submitSecretField({
        entityId: predicate.subjectId,
        predicateId: predicate.predicateId,
        plaintext: nextPlaintext,
      });
      await runtime.sync.sync();
      callbacks.onMutationSuccess?.();
      setPlaintext("");
      setStatus(
        result.created ? "Secret set." : result.rotated ? "Secret rotated." : "Secret confirmed.",
      );
    } catch (submitError) {
      const nextError = submitError instanceof Error ? submitError.message : String(submitError);
      setError(nextError);
      callbacks.onMutationError?.(
        submitError instanceof Error ? submitError : new Error(nextError),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3" data-explorer-secret-field={predicate.predicateId}>
      <div className="grid gap-3 text-sm text-slate-300">
        <div className="flex items-center justify-between gap-3">
          <span>Secret status</span>
          <span data-explorer-secret-status={predicate.predicateId}>
            {secretId ? "Present" : "Missing"}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>Secret version</span>
          <span data-explorer-secret-version={predicate.predicateId}>
            {secret?.version === undefined ? "Not set" : `v${secret.version}`}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>Last rotated</span>
          <span data-explorer-secret-last-rotated={predicate.predicateId}>
            {formatTimestamp(secret?.lastRotatedAt)}
          </span>
        </div>
      </div>

      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor={`explorer-secret-${predicate.predicateId}`}>
          {secretId ? "Rotate secret" : "Set secret"}
        </FieldLabel>
        <FieldContent>
          <Input
            aria-invalid={error ? true : undefined}
            data-explorer-secret-input={predicate.predicateId}
            id={`explorer-secret-${predicate.predicateId}`}
            onChange={(event) => {
              setPlaintext(event.target.value);
            }}
            placeholder={
              secretId ? "Paste a new plaintext value" : "Paste the plaintext value once"
            }
            type="password"
            value={plaintext}
          />
          <FieldDescription>
            Plaintext stays authority-only. The synced graph only carries the opaque handle,
            version, and rotation metadata.
          </FieldDescription>
          <FieldError data-explorer-secret-error={predicate.predicateId}>{error}</FieldError>
        </FieldContent>
      </Field>

      {status ? (
        <Alert data-explorer-secret-result={predicate.predicateId}>
          <AlertDescription>{status}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          data-explorer-secret-submit={predicate.predicateId}
          disabled={busy}
          onClick={() => {
            void handleSubmit();
          }}
          type="button"
        >
          {busy ? "Saving..." : secretId ? "Rotate secret" : "Save secret"}
        </Button>
      </div>
    </div>
  );
}
