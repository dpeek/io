import type { GraphCommandPolicy } from "@io/graph-authority";
import type { DefinitionIconRef } from "@io/graph-kernel";

/**
 * One field row inside an authored object-view section.
 */
export type ObjectViewFieldSpec = {
  readonly path: string;
  readonly label?: string;
  readonly description?: string;
};

/**
 * One section inside an authored object view.
 */
export type ObjectViewSectionSpec = {
  readonly key: string;
  readonly title: string;
  readonly description?: string;
  readonly fields: readonly ObjectViewFieldSpec[];
};

/**
 * Related-entity presentation metadata attached to an object view.
 */
export type ObjectViewRelatedSpec = {
  readonly key: string;
  readonly title: string;
  readonly relationPath: string;
  readonly presentation: "list" | "table" | "board";
};

/**
 * Pure, host-neutral object presentation contract authored beside one type or
 * small module slice.
 */
export type ObjectViewSpec = {
  readonly key: string;
  readonly entity: string;
  readonly titleField?: string;
  readonly subtitleField?: string;
  readonly sections: readonly ObjectViewSectionSpec[];
  readonly related?: readonly ObjectViewRelatedSpec[];
  readonly commands?: readonly string[];
};

/**
 * One reusable field binding inside an authored record surface. This stays
 * structurally aligned with `ObjectViewFieldSpec` so existing field rows can
 * migrate without reshaping authored layout data.
 */
export type RecordSurfaceFieldSpec = ObjectViewFieldSpec;

/**
 * One section inside an authored record surface. This stays structurally
 * aligned with `ObjectViewSectionSpec` so current object-view section data has
 * a direct compatibility path into the newer record-surface model.
 */
export type RecordSurfaceSectionSpec = ObjectViewSectionSpec;

/**
 * Related content attached to a record surface. The authored record surface
 * references a reusable collection-surface key rather than owning route or
 * renderer composition directly.
 */
export type RecordSurfaceRelatedContentSpec = {
  readonly key: string;
  readonly title: string;
  readonly description?: string;
  readonly collection: string;
};

/**
 * Pure, host-neutral record presentation contract authored beside one type or
 * small module slice.
 */
export type RecordSurfaceSpec = {
  readonly key: string;
  readonly subject: string;
  readonly titleField?: string;
  readonly subtitleField?: string;
  readonly sections: readonly RecordSurfaceSectionSpec[];
  readonly related?: readonly RecordSurfaceRelatedContentSpec[];
  readonly commandSurfaces?: readonly string[];
};

/**
 * High-level collection renderer shapes supported by authored surface specs.
 */
export type CollectionSurfacePresentationKind = "list" | "table" | "board" | "card-grid";

/**
 * Pure data hints that let a host choose a collection presentation without
 * embedding layout or component ownership into the authored contract.
 */
export type CollectionSurfacePresentationHints = {
  readonly kind: CollectionSurfacePresentationKind;
  readonly fields?: readonly string[];
  readonly recordSurface?: string;
};

/**
 * One durable collection source for an authored collection surface.
 */
export type CollectionSurfaceSourceSpec =
  | {
      readonly kind: "entity-type";
      readonly entity: string;
    }
  | {
      readonly kind: "relation";
      readonly subject: string;
      readonly relationPath: string;
    }
  | {
      readonly kind: "query";
      readonly query: string;
      readonly savedView?: string;
    };

/**
 * Pure, host-neutral collection presentation contract authored beside schema
 * and command metadata.
 */
export type CollectionSurfaceSpec = {
  readonly key: string;
  readonly title: string;
  readonly description?: string;
  readonly source: CollectionSurfaceSourceSpec;
  readonly presentation: CollectionSurfacePresentationHints;
  readonly commandSurfaces?: readonly string[];
};

/**
 * Host scopes that may provide context for a command surface without turning
 * route or shell composition into part of the authored command contract.
 */
export type GraphCommandSurfaceScope = "route" | "record" | "collection" | "workflow";

/**
 * Subject models supported by the authored command-surface layer.
 */
export type GraphCommandSurfaceSubjectModel =
  | {
      readonly kind: "none";
    }
  | {
      readonly kind: "entity";
      readonly entity: string;
    }
  | {
      readonly kind: "selection";
      readonly entity: string;
    }
  | {
      readonly kind: "scope";
      readonly scope: GraphCommandSurfaceScope;
    };

/**
 * Host-neutral input presentation hints for one authored command surface.
 */
export type GraphCommandSurfaceInputPresentation =
  | {
      readonly kind: "inline";
    }
  | {
      readonly kind: "dialog";
    }
  | {
      readonly kind: "sheet";
    }
  | {
      readonly kind: "dedicatedForm";
    };

/**
 * How the host should stage submit semantics for one command invocation.
 */
export type GraphCommandSurfaceSubmitBehavior =
  | {
      readonly kind: "optimistic";
    }
  | {
      readonly kind: "blocking";
    }
  | {
      readonly kind: "confirm";
      readonly title?: string;
      readonly message?: string;
      readonly confirmLabel?: string;
    };

/**
 * Declarative follow-up behaviors after a command completes successfully.
 */
export type GraphCommandSurfacePostSuccessBehavior =
  | {
      readonly kind: "refresh";
    }
  | {
      readonly kind: "close";
    }
  | {
      readonly kind: "navigate";
      readonly target: string;
    }
  | {
      readonly kind: "openCreatedEntity";
      readonly entity?: string;
    };

/**
 * UI-facing authored contract that describes how a human invokes a graph
 * command without taking execution or policy ownership away from
 * `GraphCommandSpec`.
 */
export type GraphCommandSurfaceSpec = {
  readonly key: string;
  readonly command: string;
  readonly label?: string;
  readonly icon?: DefinitionIconRef;
  readonly subject: GraphCommandSurfaceSubjectModel;
  readonly inputPresentation: GraphCommandSurfaceInputPresentation;
  readonly submitBehavior: GraphCommandSurfaceSubmitBehavior;
  readonly postSuccess: readonly GraphCommandSurfacePostSuccessBehavior[];
};

/**
 * One declarative step inside a workflow descriptor.
 */
export type WorkflowStepSpec = {
  readonly key: string;
  readonly title: string;
  readonly description?: string;
  readonly objectView?: string;
  readonly command?: string;
};

/**
 * Pure, host-neutral workflow descriptor that binds subjects, steps, object
 * views, and command affordances together.
 */
export type WorkflowSpec = {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly subjects: readonly string[];
  readonly steps: readonly WorkflowStepSpec[];
  readonly commands?: readonly string[];
};

/**
 * Execution strategies supported by authored graph command descriptors.
 */
export type GraphCommandExecution = "localOnly" | "optimisticVerify" | "serverOnly";

/**
 * Authored command manifest contract. Policy enforcement remains
 * authority-owned; this type only describes the module-authored command shape.
 */
export type GraphCommandSpec<Input = unknown, Output = unknown> = {
  readonly key: string;
  readonly label: string;
  readonly subject?: string;
  readonly execution: GraphCommandExecution;
  readonly input: Input;
  readonly output: Output;
  readonly policy?: GraphCommandPolicy;
};
