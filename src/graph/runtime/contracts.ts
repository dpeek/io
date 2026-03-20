export type ObjectViewFieldSpec = {
  readonly path: string;
  readonly label?: string;
  readonly description?: string;
  readonly span?: 1 | 2;
};

export type ObjectViewSectionSpec = {
  readonly key: string;
  readonly title: string;
  readonly description?: string;
  readonly fields: readonly ObjectViewFieldSpec[];
};

export type ObjectViewRelatedSpec = {
  readonly key: string;
  readonly title: string;
  readonly relationPath: string;
  readonly presentation: "list" | "table" | "board";
};

export type ObjectViewSpec = {
  readonly key: string;
  readonly entity: string;
  readonly titleField?: string;
  readonly subtitleField?: string;
  readonly sections: readonly ObjectViewSectionSpec[];
  readonly related?: readonly ObjectViewRelatedSpec[];
  readonly commands?: readonly string[];
};

export type WorkflowStepSpec = {
  readonly key: string;
  readonly title: string;
  readonly description?: string;
  readonly objectView?: string;
  readonly command?: string;
};

export type WorkflowSpec = {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly subjects: readonly string[];
  readonly steps: readonly WorkflowStepSpec[];
  readonly commands?: readonly string[];
};

export type GraphCommandExecution = "localOnly" | "optimisticVerify" | "serverOnly";

export type GraphCommandPolicy = {
  readonly capabilities?: readonly string[];
  readonly touchesPredicates?: readonly string[];
};

export type GraphCommandSpec<Input = unknown, Output = unknown> = {
  readonly key: string;
  readonly label: string;
  readonly subject?: string;
  readonly execution: GraphCommandExecution;
  readonly input: Input;
  readonly output: Output;
  readonly policy?: GraphCommandPolicy;
};
