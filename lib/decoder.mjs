const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

export function makeDecoder(wasm) {
  class DecodeError extends Error {
    constructor(kind, message, cause) {
      super(message);
      this.name = "DecodeError";
      this.kind = kind;
      if (cause !== undefined) this.cause = cause;
    }
  }

  function rebrand(err) {
    if (err instanceof DecodeError) return err;
    if (err && typeof err === "object" && typeof err.kind === "string" && err.name === "DecodeError") {
      return new DecodeError(err.kind, err.message ?? String(err), err.cause);
    }
    return null;
  }

  async function fetchText(fetchFn, url, init) {
    let response;
    try {
      response = await fetchFn(url, init);
    } catch (cause) {
      throw new DecodeError("fetch-failed", `fetch failed for ${url}`, cause);
    }
    if (!response.ok) {
      throw new DecodeError(
        "fetch-failed",
        `non-2xx response from ${url}: ${response.status}`,
        response,
      );
    }
    try {
      return await response.text();
    } catch (cause) {
      throw new DecodeError("fetch-failed", `failed to read body from ${url}`, cause);
    }
  }

  async function fetchDecodingParams(fetchFn, base64, headers, signal) {
    const init = { method: "GET", headers, signal };
    const primary = `https://news.google.com/articles/${base64}`;
    const fallback = `https://news.google.com/rss/articles/${base64}`;
    let html;
    try {
      html = await fetchText(fetchFn, primary, init);
    } catch (err) {
      if (err instanceof DecodeError && err.kind === "fetch-failed") {
        html = await fetchText(fetchFn, fallback, init);
      } else {
        throw err;
      }
    }
    try {
      return wasm.extractDecodingParams(html);
    } catch (err) {
      const rebranded = rebrand(err);
      if (rebranded) throw rebranded;
      throw new DecodeError("params-missing", "failed to extract decoding params", err);
    }
  }

  async function fetchDecodedUrl(fetchFn, base64, params, headers, signal) {
    const inner = wasm.buildBatchexecutePayload(base64, params.signature, params.timestamp);
    const body = "f.req=" + encodeURIComponent(inner);
    const init = {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body,
      signal,
    };
    const text = await fetchText(
      fetchFn,
      "https://news.google.com/_/DotsSplashUi/data/batchexecute",
      init,
    );
    try {
      return wasm.parseBatchexecuteResponse(text);
    } catch (err) {
      const rebranded = rebrand(err);
      if (rebranded) throw rebranded;
      throw new DecodeError("parse-failed", "failed to parse batchexecute response", err);
    }
  }

  async function decode(url, opts = {}) {
    const fetchFn = opts.fetch ?? globalThis.fetch;
    if (typeof fetchFn !== "function") {
      throw new DecodeError(
        "fetch-failed",
        "no fetch implementation available (pass opts.fetch or run on a runtime with globalThis.fetch)",
      );
    }
    const headers = { "User-Agent": DEFAULT_UA, ...(opts.headers ?? {}) };
    const signal = opts.signal;

    let base64;
    try {
      base64 = wasm.parseBase64(url);
    } catch (err) {
      const rebranded = rebrand(err);
      if (rebranded) throw rebranded;
      throw new DecodeError("invalid-url", "could not parse Google News URL", err);
    }

    const params = await fetchDecodingParams(fetchFn, base64, headers, signal);
    return await fetchDecodedUrl(fetchFn, base64, params, headers, signal);
  }

  return { decode, DecodeError };
}
