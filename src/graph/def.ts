/**
 * Root-owned graph definition surface for authoring helpers that do not fit an
 * extracted package cleanly.
 *
 * Kernel-owned schema/id primitives still come from `@io/graph-kernel`, but
 * this barrel intentionally gathers the remaining definition-time helpers:
 * field metadata modules, reference authoring policy, and command/view/workflow
 * specs.
 */
export {
  applyGraphIdMap as applyIdMap,
  defineEnum,
  defineScalar,
  defineType,
  readDefinitionIconId,
  type Cardinality,
  type DefinitionIconRef,
  type EdgeInput,
  type EdgeOutput,
  type EntityTypeInput,
  type EntityTypeOutput,
  type EnumOptionInput,
  type EnumTypeInput,
  type EnumTypeOutput,
  type FieldsInput,
  type FieldsOutput,
  type GraphFieldAuthority,
  type GraphFieldVisibility,
  type GraphFieldWritePolicy,
  type GraphSecretFieldAuthority,
  type RangeRef,
  type ScalarTypeInput,
  type ScalarTypeOutput,
  type ValidationIssueInput,
} from "@io/graph-kernel";

export * from "./type-module.js";
export * from "./reference-policy.js";
export * from "./definition-contracts.js";
