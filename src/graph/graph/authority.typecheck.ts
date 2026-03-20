import type {
  JsonPersistedAuthoritativeGraphOptions,
  PersistedAuthoritativeGraphCursorPrefixFactory,
  PersistedAuthoritativeGraphOptions,
  PersistedAuthoritativeGraphSeed,
  PersistedAuthoritativeGraphState,
  PersistedAuthoritativeGraphStorage,
  PersistedAuthoritativeGraphStorageLoadResult,
} from "./authority.js";
import { core } from "./core.js";
import { createIdMap, defineNamespace } from "./identity.js";
import { defineType } from "./schema.js";

const item = defineType({
  values: { key: "probe:item", name: "Probe Item" },
  fields: {
    ...core.node.fields,
  },
});

const probeGraph = defineNamespace(createIdMap({ item }).map, { item });

const createCursorPrefix: PersistedAuthoritativeGraphCursorPrefixFactory = () => "authority:";

const seed: PersistedAuthoritativeGraphSeed<typeof probeGraph> = (graph) => {
  graph.item.create({ name: "Seeded Item" });

  // @ts-expect-error persisted authority seeding only receives the typed graph client
  void graph.snapshot();
};

const loadResult = {
  snapshot: {
    edges: [],
    retracted: [],
  },
  needsPersistence: false,
} satisfies PersistedAuthoritativeGraphStorageLoadResult;

const durableState = {
  version: 1,
  snapshot: loadResult.snapshot,
  writeHistory: {
    cursorPrefix: "authority:",
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
  path: "/tmp/graph.snapshot.json",
  seed,
  createCursorPrefix,
} satisfies JsonPersistedAuthoritativeGraphOptions<typeof probeGraph>);

void ({
  storage,
  seed,
  createCursorPrefix,
} satisfies PersistedAuthoritativeGraphOptions<typeof probeGraph>);

void durableState;

void ({
  path: "/tmp/graph.snapshot.json",
  // @ts-expect-error custom storage belongs to the generic persisted authority surface, not the JSON wrapper
  storage,
} satisfies JsonPersistedAuthoritativeGraphOptions<typeof probeGraph>);

void ({
  storage,
  // @ts-expect-error namespace wiring stays outside the persisted authority options surface
  namespace: probeGraph,
} satisfies PersistedAuthoritativeGraphOptions<typeof probeGraph>);

void ({
  version: 1,
  snapshot: loadResult.snapshot,
  // @ts-expect-error durable persisted state must retain authoritative write history for cursor recovery
} satisfies PersistedAuthoritativeGraphState);
