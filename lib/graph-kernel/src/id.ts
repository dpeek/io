/**
 * Opaque durable identifier used by the graph kernel.
 */
export type GraphId = string;

const UUID_BYTE_LENGTH = 16;
const UUID_V7_SEQUENCE_BITS = 74n;
const UUID_V7_MAX_SEQUENCE = (1n << UUID_V7_SEQUENCE_BITS) - 1n;

let lastTimestampMs = -1;
let lastSequence = 0n;

const byteToHex = Array.from({ length: 256 }, (_, index) => index.toString(16).padStart(2, "0"));

function hex(byte: number): string {
  return byteToHex[byte]!;
}

function randomSequence(): bigint {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);

  let sequence = 0n;
  for (const byte of bytes) {
    sequence = (sequence << 8n) | BigInt(byte);
  }

  return sequence & UUID_V7_MAX_SEQUENCE;
}

function nextUuidV7State(): { timestampMs: number; sequence: bigint } {
  const now = Date.now();

  if (now > lastTimestampMs) {
    lastTimestampMs = now;
    lastSequence = randomSequence();
    return { timestampMs: lastTimestampMs, sequence: lastSequence };
  }

  if (lastSequence === UUID_V7_MAX_SEQUENCE) {
    lastTimestampMs += 1;
    lastSequence = randomSequence();
    return { timestampMs: lastTimestampMs, sequence: lastSequence };
  }

  lastSequence += 1n;
  return { timestampMs: lastTimestampMs, sequence: lastSequence };
}

function formatUuid(bytes: Uint8Array): string {
  return (
    hex(bytes[0]!) +
    hex(bytes[1]!) +
    hex(bytes[2]!) +
    hex(bytes[3]!) +
    "-" +
    hex(bytes[4]!) +
    hex(bytes[5]!) +
    "-" +
    hex(bytes[6]!) +
    hex(bytes[7]!) +
    "-" +
    hex(bytes[8]!) +
    hex(bytes[9]!) +
    "-" +
    hex(bytes[10]!) +
    hex(bytes[11]!) +
    hex(bytes[12]!) +
    hex(bytes[13]!) +
    hex(bytes[14]!) +
    hex(bytes[15]!)
  );
}

function createUuidV7(): string {
  const { timestampMs, sequence } = nextUuidV7State();
  const timestamp = BigInt(timestampMs);
  const randA = Number((sequence >> 62n) & 0xfffn);
  const randB = sequence & ((1n << 62n) - 1n);

  const bytes = new Uint8Array(UUID_BYTE_LENGTH);
  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);
  bytes[6] = 0x70 | ((randA >>> 8) & 0x0f);
  bytes[7] = randA & 0xff;
  bytes[8] = 0x80 | Number((randB >> 56n) & 0x3fn);
  bytes[9] = Number((randB >> 48n) & 0xffn);
  bytes[10] = Number((randB >> 40n) & 0xffn);
  bytes[11] = Number((randB >> 32n) & 0xffn);
  bytes[12] = Number((randB >> 24n) & 0xffn);
  bytes[13] = Number((randB >> 16n) & 0xffn);
  bytes[14] = Number((randB >> 8n) & 0xffn);
  bytes[15] = Number(randB & 0xffn);

  return formatUuid(bytes);
}

/**
 * Create one opaque graph identifier.
 *
 * These ids are used for runtime-created nodes and edges. The current
 * implementation emits UUIDv7 values backed by Web Crypto and preserves
 * monotonic ordering within one process when multiple ids are created in the
 * same millisecond or the local clock moves backwards. Callers should still
 * treat the returned string as an opaque token and must not infer meaning from
 * its textual shape.
 *
 * This helper requires `globalThis.crypto.getRandomValues()` to be available
 * in the active runtime.
 */
export function createGraphId(): GraphId {
  return createUuidV7();
}
