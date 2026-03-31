import type { GraphValidationIssue } from "@io/graph-client";

import type { EditSessionPath } from "./edit-session.js";

export type ValidationIssueSource = string;
export type ValidationIssueScope = string;

export type PathValidationIssueInput<Path extends EditSessionPath = EditSessionPath> = {
  path: Path;
  source: ValidationIssueSource;
  message: string;
  code?: string;
};

export type ScopedValidationIssueInput<Scope extends ValidationIssueScope = ValidationIssueScope> =
  {
    scope: Scope;
    source: ValidationIssueSource;
    message: string;
    code?: string;
  };

export type PathValidationIssue<Path extends EditSessionPath = EditSessionPath> = {
  kind: "path";
  path: Path;
  source: ValidationIssueSource;
  message: string;
  code?: string;
};

export type ScopedValidationIssue<Scope extends ValidationIssueScope = ValidationIssueScope> = {
  kind: "scope";
  scope: Scope;
  source: ValidationIssueSource;
  message: string;
  code?: string;
};

export type ValidationIssue<
  Path extends EditSessionPath = EditSessionPath,
  Scope extends ValidationIssueScope = ValidationIssueScope,
> = PathValidationIssue<Path> | ScopedValidationIssue<Scope>;

export type ValidationIssueAggregate<
  Path extends EditSessionPath = EditSessionPath,
  Scope extends ValidationIssueScope = ValidationIssueScope,
> = {
  issues: readonly ValidationIssue<Path, Scope>[];
  pathIssues: readonly PathValidationIssue<Path>[];
  scopedIssues: readonly ScopedValidationIssue<Scope>[];
  getPathIssues<MatchedPath extends EditSessionPath>(
    path: MatchedPath,
  ): readonly PathValidationIssue<MatchedPath>[];
  getScopedIssues<MatchedScope extends Scope>(
    scope: MatchedScope,
  ): readonly ScopedValidationIssue<MatchedScope>[];
};

const emptyPathIssues = Object.freeze([]) as readonly PathValidationIssue[];
const emptyScopedIssues = Object.freeze([]) as readonly ScopedValidationIssue[];

function validationIssuePathKey(path: EditSessionPath): string {
  return JSON.stringify([...path]);
}

function freezeIssueGroups<TIssue>(
  map: ReadonlyMap<string, readonly TIssue[]>,
): ReadonlyMap<string, readonly TIssue[]> {
  return new Map(
    [...map.entries()].map(([key, issues]) => [key, Object.freeze([...issues])] as const),
  );
}

function appendIssue<TIssue>(map: Map<string, TIssue[]>, key: string, issue: TIssue): void {
  const current = map.get(key);
  if (current) {
    current.push(issue);
    return;
  }

  map.set(key, [issue]);
}

export function createPathValidationIssue<Path extends EditSessionPath>(
  issue: PathValidationIssueInput<Path>,
): PathValidationIssue<Path> {
  return {
    kind: "path",
    ...(issue.code === undefined ? {} : { code: issue.code }),
    message: issue.message,
    path: Object.freeze([...issue.path]) as Path,
    source: issue.source,
  };
}

export function createScopedValidationIssue<Scope extends ValidationIssueScope>(
  issue: ScopedValidationIssueInput<Scope>,
): ScopedValidationIssue<Scope> {
  return {
    kind: "scope",
    ...(issue.code === undefined ? {} : { code: issue.code }),
    message: issue.message,
    scope: issue.scope,
    source: issue.source,
  };
}

export function isPathValidationIssue<Path extends EditSessionPath = EditSessionPath>(
  issue: ValidationIssue<Path>,
): issue is PathValidationIssue<Path> {
  return issue.kind === "path";
}

export function isScopedValidationIssue<Scope extends ValidationIssueScope = ValidationIssueScope>(
  issue: ValidationIssue<EditSessionPath, Scope>,
): issue is ScopedValidationIssue<Scope> {
  return issue.kind === "scope";
}

export function cloneValidationIssue<Path extends EditSessionPath>(
  issue: PathValidationIssue<Path>,
): PathValidationIssue<Path>;
export function cloneValidationIssue<Scope extends ValidationIssueScope>(
  issue: ScopedValidationIssue<Scope>,
): ScopedValidationIssue<Scope>;
export function cloneValidationIssue<
  Path extends EditSessionPath = EditSessionPath,
  Scope extends ValidationIssueScope = ValidationIssueScope,
>(issue: ValidationIssue<Path, Scope>): ValidationIssue<Path, Scope> {
  return issue.kind === "path"
    ? createPathValidationIssue(issue)
    : createScopedValidationIssue(issue);
}

export function normalizeGraphValidationIssue(
  issue: Pick<GraphValidationIssue, "code" | "message" | "path" | "source">,
): PathValidationIssue {
  return createPathValidationIssue({
    code: issue.code,
    message: issue.message,
    path: issue.path,
    source: issue.source,
  });
}

export function normalizeGraphValidationIssues(
  issues: readonly Pick<GraphValidationIssue, "code" | "message" | "path" | "source">[],
): readonly PathValidationIssue[] {
  return Object.freeze(issues.map((issue) => normalizeGraphValidationIssue(issue)));
}

export function collectValidationIssuesForPath<Path extends EditSessionPath>(
  issues: readonly ValidationIssue[],
  path: Path,
): readonly PathValidationIssue<Path>[] {
  const key = validationIssuePathKey(path);
  const matched = issues
    .filter((issue): issue is PathValidationIssue<Path> => {
      return issue.kind === "path" && validationIssuePathKey(issue.path) === key;
    })
    .map((issue) => cloneValidationIssue(issue));
  return Object.freeze(matched);
}

export function collectValidationIssuesForScope<Scope extends ValidationIssueScope>(
  issues: readonly ValidationIssue[],
  scope: Scope,
): readonly ScopedValidationIssue<Scope>[] {
  const matched = issues
    .filter((issue): issue is ScopedValidationIssue<Scope> => {
      return issue.kind === "scope" && issue.scope === scope;
    })
    .map((issue) => cloneValidationIssue(issue));
  return Object.freeze(matched);
}

export function aggregateValidationIssues<
  Path extends EditSessionPath = EditSessionPath,
  Scope extends ValidationIssueScope = ValidationIssueScope,
>(issues: readonly ValidationIssue<Path, Scope>[]): ValidationIssueAggregate<Path, Scope> {
  const clonedIssues: ValidationIssue<Path, Scope>[] = [];
  const pathIssues: PathValidationIssue<Path>[] = [];
  const scopedIssues: ScopedValidationIssue<Scope>[] = [];
  const issuesByPath = new Map<string, PathValidationIssue<Path>[]>();
  const issuesByScope = new Map<string, ScopedValidationIssue<Scope>[]>();

  for (const issue of issues) {
    if (issue.kind === "path") {
      const clonedIssue = createPathValidationIssue(issue);
      clonedIssues.push(clonedIssue);
      pathIssues.push(clonedIssue);
      appendIssue(issuesByPath, validationIssuePathKey(clonedIssue.path), clonedIssue);
      continue;
    }

    const clonedIssue = createScopedValidationIssue(issue);
    clonedIssues.push(clonedIssue);
    scopedIssues.push(clonedIssue);
    appendIssue(issuesByScope, clonedIssue.scope, clonedIssue);
  }

  const frozenIssues = Object.freeze([...clonedIssues]) as readonly ValidationIssue<Path, Scope>[];
  const frozenPathIssues = Object.freeze([...pathIssues]) as readonly PathValidationIssue<Path>[];
  const frozenScopedIssues = Object.freeze([
    ...scopedIssues,
  ]) as readonly ScopedValidationIssue<Scope>[];
  const frozenIssuesByPath = freezeIssueGroups(issuesByPath);
  const frozenIssuesByScope = freezeIssueGroups(issuesByScope);

  return {
    issues: frozenIssues,
    pathIssues: frozenPathIssues,
    scopedIssues: frozenScopedIssues,
    getPathIssues<MatchedPath extends EditSessionPath>(
      path: MatchedPath,
    ): readonly PathValidationIssue<MatchedPath>[] {
      return (frozenIssuesByPath.get(validationIssuePathKey(path)) ??
        emptyPathIssues) as readonly PathValidationIssue<MatchedPath>[];
    },
    getScopedIssues<MatchedScope extends Scope>(
      scope: MatchedScope,
    ): readonly ScopedValidationIssue<MatchedScope>[] {
      return (frozenIssuesByScope.get(scope) ??
        emptyScopedIssues) as readonly ScopedValidationIssue<MatchedScope>[];
    },
  };
}
