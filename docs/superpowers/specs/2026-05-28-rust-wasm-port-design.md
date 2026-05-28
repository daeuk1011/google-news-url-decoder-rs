# Rust → WASM Port of google-news-url-decoder

Date: 2026-05-28
Status: Approved design, ready for implementation planning
Source reference: https://github.com/daeuk1011/google-news-url-decoder (Python)

## Summary

Port the Python `googlenewsdecoder` library to Rust, compiled to WebAssembly,
distributed as a single npm package consumable from any JS runtime that exposes
a global `fetch` (Node.js 18+, Cloudflare Workers, Deno, Bun). The browser is
explicitly out of scope because `news.google.com` does not return CORS headers
to third-party origins.

## Goals

- Provide a single async function `decode(url, opts?)` that takes a Google News
  share URL and returns the original article URL.
- Reuse the exact request shape proven in the Python implementation
  (`new_decoderv3.py`) so that Google's endpoints accept the payload unchanged.
- Ship one isomorphic build that works in Node.js, Workers, Deno, and Bun.
- Stay under 100 KB gzip for the published `.wasm` artifact.

## Non-goals

- Browser execution. CORS makes direct calls impossible and a Worker / proxy
  layer is the user's responsibility, not the library's.
- Built-in proxy support. Each runtime has its own mechanism
  (`undici.ProxyAgent`, `Deno.createHttpClient`, Workers fetch). Users inject
  a custom `fetch` via `opts.fetch` instead.
- Built-in rate-limit / interval sleep. `await new Promise(r => setTimeout(r, ms))`
  is a one-liner; the library should not own this.
- A batch API. Callers compose with `Promise.all([decode(a), decode(b)])`.

## Package layout

```
google-news-url-decoder/
├── Cargo.toml              # crate-type = ["cdylib"]
├── src/lib.rs              # #[wasm_bindgen] entry point + DecodeError
├── src/parse.rs            # pure: parse_base64, extract sg/ts from HTML, parse batchexecute response
├── src/decode.rs           # async orchestration (fetch calls + step wiring)
├── pkg/                    # wasm-pack output (gitignored, published to npm)
├── tests/                  # Rust unit tests
├── test/                   # Node integration tests (node --test)
│   └── decode.test.mjs
├── examples/
│   ├── node.mjs
│   └── workers.ts
├── package.json            # npm metadata, wraps pkg/
├── .github/workflows/ci.yml
└── README.md
```

## Build

- Tool: `wasm-pack build --target bundler --release`
  - `bundler` target is the most portable across Node 18+, Workers, Deno, Bun,
    and JS bundlers (esbuild, Vite, Webpack, Rollup).
- Optional `--target nodejs` script for users who want a CJS-friendly build.
- Key dependencies:
  - `wasm-bindgen`, `js-sys`, `web-sys` (Fetch, Headers, Request, Response, AbortSignal)
  - `serde`, `serde_json`
  - `tl` for HTML parsing (lightweight; falls back to `scraper` if `tl` cannot
    locate the required attributes reliably in fixture testing)
  - `urlencoding` for percent-encoding the `f.req` body
  - `thiserror` for `DecodeError`

## Public API (TypeScript shape exposed by `pkg/`)

```ts
export interface DecodeOptions {
  /** External fetch implementation. Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
  /** Extra request headers, merged over the default User-Agent. */
  headers?: Record<string, string>;
  /** Forwarded to every underlying fetch call. */
  signal?: AbortSignal;
}

export function decode(url: string, opts?: DecodeOptions): Promise<string>;

export class DecodeError extends Error {
  kind: "invalid-url" | "fetch-failed" | "params-missing" | "parse-failed";
  cause?: unknown;
}
```

Success: resolves with the decoded original URL string.
Failure: rejects with a `DecodeError` whose `kind` discriminates the failure
class. Callers branch on `err.kind` in `catch`.

## Internal flow

```
decode(url, opts)
  │
  ├─ 1. parse_base64(url)                                 [pure, sync]
  │     - hostname must equal "news.google.com"
  │     - path segments end with /articles/{X} or /read/{X}
  │     - else throw DecodeError { kind: "invalid-url" }
  │
  ├─ 2. fetch_decoding_params(base64)                     [async]
  │     - GET https://news.google.com/articles/{base64}
  │     - on network / non-2xx HTTP error, retry once against
  │       https://news.google.com/rss/articles/{base64}
  │       (matches the Python implementation, which falls back only on
  │       transport-level failures, not on missing attributes)
  │     - parse HTML, find `c-wiz > div[jscontroller]`
  │     - read attributes `data-n-a-sg` (signature) and `data-n-a-ts` (timestamp)
  │     - attributes missing on the successful response → DecodeError { kind: "params-missing" }
  │     - both URLs fail at the network layer → DecodeError { kind: "fetch-failed", cause }
  │
  └─ 3. fetch_decoded_url(signature, timestamp, base64)   [async]
        - POST https://news.google.com/_/DotsSplashUi/data/batchexecute
        - Content-Type: application/x-www-form-urlencoded;charset=UTF-8
        - User-Agent: Mozilla/5.0 ... Chrome/129.0.0.0 ...  (matches Python lib)
        - Body: f.req=<percent-encoded JSON>
          where the JSON is the exact nested structure from new_decoderv3.py
          (preserved byte-for-byte to avoid format-validation rejections)
        - Parse: split response text on "\n\n", JSON.parse the second chunk,
          drop the trailing 2 elements, then JSON.parse element [0][2], take [1].
        - Parse failure → DecodeError { kind: "parse-failed", cause }
        - Network failure → DecodeError { kind: "fetch-failed", cause }
```

## Error model

`DecodeError` is the single error type thrown. `kind` values:

- `invalid-url` — input URL is not a recognized Google News article URL.
- `fetch-failed` — underlying `fetch` rejected or returned a non-2xx HTTP status.
- `params-missing` — the successful response (primary or RSS fallback) lacked
  the `data-n-a-sg` / `data-n-a-ts` attributes.
- `parse-failed` — batchexecute response could not be decoded into the expected
  nested JSON shape.

`cause` carries the original underlying error (network error, JSON parse error,
HTTP response object) when applicable, following the standard `Error.cause`
convention.

## Testing strategy

Three levels, each independently runnable.

### 1. Rust unit tests (`cargo test`)

Pure-function coverage:

- `parse_base64` — valid `/articles/...` URL, valid `/read/...` URL, wrong host,
  missing segment, malformed URL.
- HTML attribute extraction — fixture HTML strings (saved from real responses),
  including the missing-attribute case.
- batchexecute response parser — fixture response bodies for the success case,
  malformed JSON, and the unexpected-nesting case.

### 2. Node integration tests (`node --test`)

Run against the built `pkg/`. A mocked `fetch` is injected via `opts.fetch`
to drive scenarios deterministically:

- happy path: `/articles` returns valid HTML, batchexecute returns valid body.
- `/articles` fails (5xx) → `/rss/articles` fallback succeeds.
- Both `/articles` and `/rss/articles` fail at the network layer → `fetch-failed`.
- `/articles` returns 200 but HTML is missing the expected attributes → `params-missing` (no fallback, matches Python).
- batchexecute returns malformed body → `parse-failed`.
- `signal` aborts mid-flight → fetch rejection propagates as `fetch-failed`.

### 3. E2E smoke (`test/e2e.test.mjs`)

Calls the real `news.google.com` with one or two known share URLs. Only runs
when `RUN_E2E=1` is set, so CI does not flake on Google rate limits or upstream
format changes. A scheduled GitHub Actions workflow runs it weekly to catch
upstream drift early.

## CI (GitHub Actions)

- `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`
- `wasm-pack build --target bundler --release`
- `node --test test/` (uses the freshly built `pkg/`)
- Bundle size check: fail if `pkg/*_bg.wasm` > 100 KB gzipped
- Separate weekly workflow runs the E2E suite with `RUN_E2E=1`

## Open risks

- **Google response-format drift.** The batchexecute response shape is
  undocumented. The weekly E2E run is the early-warning system.
- **`tl` crate adequacy.** If `tl` cannot reliably locate the
  `c-wiz > div[jscontroller]` node across response variants, swap to `scraper`.
  Decided during implementation based on fixture coverage; not a design-blocking
  question.
- **Bundle size.** `scraper` pulls in `html5ever` and pushes WASM size above
  100 KB; `tl` is the lighter default. If both options exceed the budget, the
  budget is renegotiated rather than the parser being hand-rolled.
