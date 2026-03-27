import { GraphValidationError, type GraphMutationValidationResult } from "@io/graph-client";

export type MutationValidation = GraphMutationValidationResult | false;

export type MutationCallbacks = {
  onMutationError?: (error: unknown) => void;
  onMutationSuccess?: () => void;
};

export function performValidatedMutation(
  { onMutationError, onMutationSuccess }: MutationCallbacks,
  validate: () => MutationValidation,
  mutate: () => boolean,
): boolean {
  const validation = validate();
  if (validation !== false && !validation.ok) {
    onMutationError?.(new GraphValidationError(validation));
    return false;
  }

  try {
    const applied = mutate();
    if (applied) onMutationSuccess?.();
    return applied;
  } catch (error) {
    if (error instanceof GraphValidationError && onMutationError) {
      onMutationError(error);
      return false;
    }
    throw error;
  }
}
