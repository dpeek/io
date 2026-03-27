import { applyGraphIdMap, createGraphIdMap, defineType } from "@io/graph-kernel";

import type {
  JsonPersistedAuthoritativeGraphOptions,
  PersistedAuthoritativeGraphCursorPrefixFactory,
  PersistedAuthoritativeGraphOptions,
  PersistedAuthoritativeGraphSeed,
  PersistedAuthoritativeGraphState,
  PersistedAuthoritativeGraphStorage,
  PersistedAuthoritativeGraphStorageLoadResult,
} from "./index.js";

const item = defineType({
  values: { key: "probe:item", name: "Probe Item" },
  fields: {},
});

const probeGraph = applyGraphIdMap(createGraphIdMap({ item }).map, { item });
const probeDefinitions = probeGraph;

const createCursorPrefix: PersistedAuthoritativeGraphCursorPrefixFactory = () => "authority:";

const seed: PersistedAuthoritativeGraphSeed<typeof probeGraph, typeof probeDefinitions> = (
  graph,
) => {
  graph.item.create({});

  // @ts-expect-error persisted authority seeds only receive the typed namespace client
  void graph.snapshot();
};

const loadResult = {
  snapshot: {
    edges: [],
    retracted: [],
  },
  recovery: "none",
  startupDiagnostics: {
    recovery: "none",
    repairReasons: [],
    resetReasons: [],
  },
} satisfies PersistedAuthoritativeGraphStorageLoadResult;

const durableState = {
  version: 1,
  snapshot: loadResult.snapshot,
  writeHistory: {
    cursorPrefix: "authority:",
    retainedHistoryPolicy: {
      kind: "all",
    },
    baseSequence: 0,
    results: [],
  },
} satisfies PersistedAuthoritativeGraphState;

const storage = {
  async load() {
    return loadResult;
  },
  async commit(input) {
    void (input.snapshot satisfies PersistedAuthoritativeGraphState["snapshot"]);
    void (input.writeHistory satisfies PersistedAuthoritativeGraphState["writeHistory"]);
  },
  async persist(input) {
    void (input.snapshot satisfies PersistedAuthoritativeGraphState["snapshot"]);
    void (input.writeHistory satisfies PersistedAuthoritativeGraphState["writeHistory"]);
  },
} satisfies PersistedAuthoritativeGraphStorage;

void ({
  definitions: probeDefinitions,
  path: "/tmp/graph.snapshot.json",
  seed,
  createCursorPrefix,
} satisfies JsonPersistedAuthoritativeGraphOptions<typeof probeGraph, typeof probeDefinitions>);

void ({
  definitions: probeDefinitions,
  storage,
  seed,
  createCursorPrefix,
} satisfies PersistedAuthoritativeGraphOptions<typeof probeGraph, typeof probeDefinitions>);

void durableState;
