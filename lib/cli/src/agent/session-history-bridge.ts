import type {
  AgentSessionAppendRequest,
  AgentSessionAppendResult,
} from "@io/graph-module-workflow";

import {
  createAgentSessionAppendRequestFromRetainedEvents,
  type AgentSessionAppendLaunchContext,
} from "./session-history.js";
import type { AgentSessionEvent } from "./tui/session-events.js";

export type AgentSessionAppendTransport = (
  request: AgentSessionAppendRequest,
) => Promise<AgentSessionAppendResult>;

export interface AgentSessionHistoryObserver {
  flush(): Promise<void>;
  observe(event: AgentSessionEvent): Promise<void>;
}

export interface AgentSessionHistoryBridgeOptions {
  readonly append: AgentSessionAppendTransport;
  readonly launch: AgentSessionAppendLaunchContext;
}

function formatSessionAppendFailure(
  result: Extract<AgentSessionAppendResult, { readonly ok: false }>,
) {
  return `Graph-backed session append failed (${result.code}): ${result.message}`;
}

export class AgentSessionHistoryBridge implements AgentSessionHistoryObserver {
  readonly #append: AgentSessionAppendTransport;
  readonly #launch: AgentSessionAppendLaunchContext;
  #nextExpectedSequence = 1;
  #pending: Promise<void> = Promise.resolve();
  #sessionId?: string;

  constructor(options: AgentSessionHistoryBridgeOptions) {
    this.#append = options.append;
    this.#launch = options.launch;
  }

  get nextExpectedSequence() {
    return this.#nextExpectedSequence;
  }

  get sessionId() {
    return this.#sessionId;
  }

  appendEvents(events: readonly AgentSessionEvent[]): Promise<void> {
    if (!events.length) {
      return this.flush();
    }

    const operation = async () => {
      const request = createAgentSessionAppendRequestFromRetainedEvents({
        events,
        launch: {
          ...this.#launch,
          ...(this.#sessionId ? { sessionId: this.#sessionId } : {}),
        },
      });
      const result = await this.#append(request);

      if (!result.ok) {
        throw new Error(formatSessionAppendFailure(result));
      }

      if (this.#sessionId && result.session.sessionId !== this.#sessionId) {
        throw new Error(
          `Graph-backed session append changed session id from "${this.#sessionId}" to "${result.session.sessionId}".`,
        );
      }
      if (result.events.length !== events.length) {
        throw new Error(
          `Graph-backed session append returned ${result.events.length} acknowledgements for ${events.length} events.`,
        );
      }

      for (const [index, acknowledgement] of result.events.entries()) {
        const event = events[index];
        if (!event) {
          throw new Error("Graph-backed session append acknowledgement index was out of range.");
        }
        if (acknowledgement.sequence !== event.sequence) {
          throw new Error(
            `Graph-backed session append acknowledged sequence ${acknowledgement.sequence} for event ${event.sequence}.`,
          );
        }
      }

      if (result.nextExpectedSequence < this.#nextExpectedSequence) {
        throw new Error(
          `Graph-backed session append moved nextExpectedSequence backwards from ${this.#nextExpectedSequence} to ${result.nextExpectedSequence}.`,
        );
      }

      this.#sessionId = result.session.sessionId;
      this.#nextExpectedSequence = result.nextExpectedSequence;
    };

    this.#pending = this.#pending.then(operation);
    return this.#pending;
  }

  flush(): Promise<void> {
    return this.#pending;
  }

  observe(event: AgentSessionEvent): Promise<void> {
    return this.appendEvents([event]);
  }
}
