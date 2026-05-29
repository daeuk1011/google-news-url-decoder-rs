export interface DecodeOptions {
  /** External fetch implementation. Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
  /** Extra request headers, merged over the default User-Agent. */
  headers?: Record<string, string>;
  /** Forwarded to every underlying fetch call. */
  signal?: AbortSignal;
}

export type DecodeErrorKind =
  | "invalid-url"
  | "fetch-failed"
  | "rate-limited"
  | "params-missing"
  | "parse-failed";

export class DecodeError extends Error {
  readonly kind: DecodeErrorKind;
  readonly cause?: unknown;
  constructor(kind: DecodeErrorKind, message: string, cause?: unknown);
}

export function decode(url: string, opts?: DecodeOptions): Promise<string>;

export interface DecodeBatchOptions extends DecodeOptions {
  /** Max URLs per batchexecute POST. Server tolerates 150+; default 50. */
  batchSize?: number;
  /** Max concurrent param-fetch GETs in flight. Default 20. */
  concurrency?: number;
}

/** Per-URL outcome, aligned to the input array order. */
export type BatchResult =
  | { url: string; decoded: string }
  | { url: string; error: DecodeError };

/**
 * Decode many Google News URLs, collapsing the final decode step into batched
 * batchexecute POSTs (`batchSize` URLs per request). Per-URL failures are isolated:
 * a single bad URL yields an `error` entry without affecting the others. Results are
 * returned in the same order as `urls`.
 */
export function decodeBatch(
  urls: string[],
  opts?: DecodeBatchOptions,
): Promise<BatchResult[]>;
