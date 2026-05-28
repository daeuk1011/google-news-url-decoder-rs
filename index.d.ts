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
  | "params-missing"
  | "parse-failed";

export class DecodeError extends Error {
  readonly kind: DecodeErrorKind;
  readonly cause?: unknown;
  constructor(kind: DecodeErrorKind, message: string, cause?: unknown);
}

export function decode(url: string, opts?: DecodeOptions): Promise<string>;
