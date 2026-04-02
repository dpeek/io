/**
 * Curated module-definition authoring surface.
 *
 * `@io/graph-module` owns authored type-module helpers, reference-field policy,
 * secret-field helpers layered over kernel primitives, and pure module-facing
 * contracts such as command, command-surface, object-view, record-surface,
 * collection-surface, and workflow specs.
 *
 * In this repo, "graph module" refers to concrete namespace slices such as
 * `core` and `workflow`, while "type module" refers to the reusable
 * `{ type, meta, filter, field(...) }` authoring object exposed here.
 *
 * This package does not own module installation, activation, registry,
 * permission runtime, or host composition concerns.
 */
export {
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

export * from "./type.js";
export * from "./reference.js";
export * from "./contracts.js";
export * from "./manifest.js";
export * from "./enum.js";
export * from "./string.js";
