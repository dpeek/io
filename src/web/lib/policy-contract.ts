/**
 * Explicit policy-contract epoch for web authority evaluator semantics.
 *
 * Bump this when `authorizeRead(...)`, `authorizeWrite(...)`,
 * `authorizeCommand(...)`, or scoped policy-filter identity changes in a way
 * that affects allow/deny or visibility for the same stored graph state.
 */
export const webAuthorityPolicyEvaluatorVersion = 0;
