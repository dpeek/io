import type {
  WorkflowMutationAction,
  WorkflowMutationResult,
} from "@io/core/graph/modules/workflow";
import { type AuthorizationContext } from "@io/graph-authority";

import {
  createInMemoryTestWebAppAuthorityStorage,
  type PersistedTestWebAppAuthorityState,
} from "./authority-test-storage.js";
import {
  createWebAppAuthority,
  type WebAppAuthority,
  type WebAppAuthorityOptions,
  type WebAppAuthorityStorage,
} from "./authority.js";

export type WorkflowFixture = {
  readonly branchId: string;
  readonly projectId: string;
  readonly repositoryBranchId: string;
  readonly repositoryId: string;
};

type TestWebAppAuthorityOptions = Omit<WebAppAuthorityOptions, "seedExampleGraph">;
type PersistedWorkflowFixture = {
  readonly fixture: WorkflowFixture;
  readonly state: PersistedTestWebAppAuthorityState;
};

let persistedWorkflowFixturePromise: Promise<PersistedWorkflowFixture> | null = null;

function cloneTestValue<T>(value: T): T {
  return structuredClone(value);
}

export async function createTestWebAppAuthority(
  storage: WebAppAuthorityStorage = createInMemoryTestWebAppAuthorityStorage().storage,
  options: TestWebAppAuthorityOptions = {},
): Promise<WebAppAuthority> {
  return createWebAppAuthority(storage, {
    ...options,
    seedExampleGraph: false,
  });
}

export async function executeTestWorkflowMutation(
  authority: WebAppAuthority,
  authorization: AuthorizationContext,
  input: WorkflowMutationAction,
): Promise<WorkflowMutationResult> {
  return (await authority.executeCommand(
    {
      kind: "workflow-mutation",
      input,
    },
    { authorization },
  )) as WorkflowMutationResult;
}

export async function createTestWorkflowFixture(
  authority: WebAppAuthority,
  authorization: AuthorizationContext,
): Promise<WorkflowFixture> {
  const project = await executeTestWorkflowMutation(authority, authorization, {
    action: "createProject",
    title: "IO",
    projectKey: "project:io",
  });
  const repository = await executeTestWorkflowMutation(authority, authorization, {
    action: "createRepository",
    projectId: project.summary.id,
    title: "io",
    repositoryKey: "repo:io",
    repoRoot: "/tmp/io",
    defaultBaseBranch: "main",
  });
  const branch = await executeTestWorkflowMutation(authority, authorization, {
    action: "createBranch",
    projectId: project.summary.id,
    title: "Workflow authority",
    branchKey: "branch:workflow-authority",
    state: "ready",
  });
  const repositoryBranch = await executeTestWorkflowMutation(authority, authorization, {
    action: "attachBranchRepositoryTarget",
    branchId: branch.summary.id,
    repositoryId: repository.summary.id,
    branchName: "workflow-authority",
    baseBranchName: "main",
  });

  return {
    branchId: branch.summary.id,
    projectId: project.summary.id,
    repositoryBranchId: repositoryBranch.summary.id,
    repositoryId: repository.summary.id,
  };
}

async function getPersistedWorkflowFixture(
  authorization: AuthorizationContext,
): Promise<PersistedWorkflowFixture> {
  if (!persistedWorkflowFixturePromise) {
    persistedWorkflowFixturePromise = (async () => {
      const storage = createInMemoryTestWebAppAuthorityStorage();
      const authority = await createTestWebAppAuthority(storage.storage);
      const fixture = await createTestWorkflowFixture(authority, authorization);
      const state = storage.read();

      if (!state) {
        throw new Error("Expected a persisted workflow fixture snapshot.");
      }

      return {
        fixture: cloneTestValue(fixture),
        state,
      };
    })();
  }

  const fixture = await persistedWorkflowFixturePromise;
  return {
    fixture: cloneTestValue(fixture.fixture),
    state: cloneTestValue(fixture.state),
  };
}

export async function createTestWebAppAuthorityWithWorkflowFixture(
  authorization: AuthorizationContext,
): Promise<{
  readonly authority: WebAppAuthority;
  readonly fixture: WorkflowFixture;
  readonly storage: ReturnType<typeof createInMemoryTestWebAppAuthorityStorage>;
}> {
  const baseline = await getPersistedWorkflowFixture(authorization);
  const storage = createInMemoryTestWebAppAuthorityStorage(baseline.state);
  const authority = await createTestWebAppAuthority(storage.storage);

  return {
    authority,
    fixture: baseline.fixture,
    storage,
  };
}
