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
    // Google throttles via 429 or by redirecting to its /sorry/ abuse page. Surface this
    // as a distinct kind so callers can back off / retry rather than treating it as fatal.
    if (response.status === 429 || (response.url && response.url.includes("/sorry/"))) {
      throw new DecodeError(
        "rate-limited",
        `rate limited by Google for ${url}`,
        response,
      );
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
      // Google throttles the non-rss /articles/ path independently of /rss/articles/,
      // so retry the rss path on rate-limiting too — not just plain fetch failures.
      if (err instanceof DecodeError && (err.kind === "fetch-failed" || err.kind === "rate-limited")) {
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

  async function decodeBatch(urls, opts = {}) {
    const fetchFn = opts.fetch ?? globalThis.fetch;
    if (typeof fetchFn !== "function") {
      throw new DecodeError(
        "fetch-failed",
        "no fetch implementation available (pass opts.fetch or run on a runtime with globalThis.fetch)",
      );
    }
    const headers = { "User-Agent": DEFAULT_UA, ...(opts.headers ?? {}) };
    const signal = opts.signal;
    const batchSize = opts.batchSize ?? 50;
    const concurrency = Math.max(1, opts.concurrency ?? 20);

    const results = new Array(urls.length);
    const pending = []; // { slot, base64, params }

    // Phase 1: parse each URL and fetch its per-article decoding params, with at most
    // `concurrency` GETs in flight. Failures are isolated to their own slot so one bad
    // URL never sinks the batch.
    async function harvest(i) {
      const url = urls[i];
      let base64;
      try {
        base64 = wasm.parseBase64(url);
      } catch (err) {
        results[i] = {
          url,
          error: rebrand(err) ?? new DecodeError("invalid-url", "could not parse Google News URL", err),
        };
        return;
      }
      try {
        const params = await fetchDecodingParams(fetchFn, base64, headers, signal);
        pending.push({ slot: i, base64, params });
      } catch (err) {
        results[i] = {
          url,
          error:
            err instanceof DecodeError
              ? err
              : new DecodeError("fetch-failed", "failed to fetch decoding params", err),
        };
      }
    }

    let next = 0;
    const workers = Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
      while (next < urls.length) {
        await harvest(next++);
      }
    });
    await Promise.all(workers);

    // Phase 2: collapse the pending URLs into batched batchexecute POSTs.
    for (let i = 0; i < pending.length; i += batchSize) {
      const chunk = pending.slice(i, i + batchSize);
      try {
        const items = chunk.map((p) => [p.base64, p.params.signature, p.params.timestamp]);
        const payload = wasm.buildBatchexecuteBatchPayload(JSON.stringify(items));
        const text = await fetchText(
          fetchFn,
          "https://news.google.com/_/DotsSplashUi/data/batchexecute",
          {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
            body: "f.req=" + encodeURIComponent(payload),
            signal,
          },
        );
        // index in the response is 1-based, matching the chunk-local order we sent.
        const map = JSON.parse(wasm.parseBatchexecuteBatchResponse(text));
        chunk.forEach((p, k) => {
          const decoded = map[String(k + 1)];
          results[p.slot] = decoded
            ? { url: urls[p.slot], decoded }
            : {
                url: urls[p.slot],
                error: new DecodeError("parse-failed", "no result for this URL in batch response"),
              };
        });
      } catch (err) {
        const e =
          err instanceof DecodeError
            ? err
            : rebrand(err) ?? new DecodeError("parse-failed", "batch decode failed", err);
        for (const p of chunk) results[p.slot] = { url: urls[p.slot], error: e };
      }
    }

    return results;
  }

  return { decode, decodeBatch, DecodeError };
}
