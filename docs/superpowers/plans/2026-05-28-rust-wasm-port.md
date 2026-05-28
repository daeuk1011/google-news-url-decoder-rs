# Rust → WASM Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Python `googlenewsdecoder` to a Rust crate compiled to WebAssembly, distributed as a single npm package consumable from Node 18+, Cloudflare Workers, Deno, and Bun.

**Architecture:** Rust is responsible only for the pure parsing and payload-building logic; HTTP is delegated to the JS runtime's `fetch`. A thin JS wrapper (`index.mjs`) orchestrates the two `fetch` calls, handles the `/articles` → `/rss/articles` fallback, and rebrands errors as `DecodeError`. This isolates the Rust surface to four pure functions and avoids the complexity of calling `fetch` from inside WASM.

**Tech Stack:** Rust 2021 + `wasm-bindgen`, `tl` (HTML parsing), `serde_json`, `url`, `urlencoding` (Rust side); `wasm-pack --target bundler` (build); plain ESM JS + `node --test` (JS side); GitHub Actions (CI).

---

## File Structure

| Path | Purpose |
|---|---|
| `Cargo.toml` | Rust crate manifest. `crate-type = ["cdylib", "rlib"]` for both WASM and unit-test builds. |
| `src/lib.rs` | Module roots and re-exports. |
| `src/parse.rs` | Pure parsing helpers (`parse_base64`, `extract_decoding_params`, `parse_batchexecute_response`). Heavily unit-tested. |
| `src/payload.rs` | `build_batchexecute_payload` — builds the inner JSON body that Google's `batchexecute` endpoint expects. |
| `src/lib.rs` (`#[wasm_bindgen]` exports) | Thin layer that re-exposes the four pure functions to JS. Errors are thrown as plain `Error` with `name`/`kind`/`cause` set. |
| `package.json` | npm metadata. Declares `"main": "index.mjs"`, `"types": "index.d.ts"`, and points npm at the built `pkg/` artifacts. |
| `lib/decoder.mjs` | Shared orchestration logic. Exports `makeDecoder(wasm)` which returns `{ decode, DecodeError }`. Lets us swap the WASM build per runtime condition. |
| `index.mjs` | Default entry. Imports the **nodejs-target** WASM build from `pkg-node/`. Works directly in Node, Bun, and Deno (`npm:` specifier) without a bundler. |
| `index.workerd.mjs` | Cloudflare Workers entry. Imports the **bundler-target** WASM build from `pkg/`. Selected automatically via the `workerd` exports condition, which wrangler honors. |
| `index.d.ts` | TypeScript declarations. |
| `test/decode.test.mjs` | Node integration tests with mocked fetch. |
| `test/e2e.test.mjs` | E2E smoke test against real `news.google.com`. Gated by `RUN_E2E=1`. |
| `examples/node.mjs` | Minimal usage example. |
| `examples/workers.ts` | Cloudflare Workers usage example. |
| `.github/workflows/ci.yml` | Fmt, clippy, cargo test, wasm-pack build, Node integration tests, bundle size check. |
| `.github/workflows/e2e.yml` | Weekly E2E run against real Google endpoints. |
| `README.md` | Install, usage, error model, runtime support matrix. |

---

## Task 1: Project scaffolding

**Files:**
- Create: `Cargo.toml`
- Create: `src/lib.rs`
- Modify: `.gitignore` (add `target/`, `pkg/`, `node_modules/` — already present from earlier commit; verify)

- [ ] **Step 1: Verify `wasm-pack` is installed**

Run: `wasm-pack --version`
Expected: prints a version like `wasm-pack 0.12.x`. If "command not found", run `cargo install wasm-pack`.

- [ ] **Step 2: Write `Cargo.toml`**

```toml
[package]
name = "google-news-url-decoder"
version = "0.1.0"
edition = "2021"
description = "Decode Google News article share URLs to their original article URL."
license = "MIT"
repository = "https://github.com/daeuk1011/google-news-url-decoder"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
wasm-bindgen = "0.2"
js-sys = "0.3"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tl = "0.7"
url = "2.5"
urlencoding = "2"

[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
```

- [ ] **Step 3: Write minimal `src/lib.rs`**

```rust
mod parse;
mod payload;
```

- [ ] **Step 4: Verify the crate compiles for the host**

Run: `cargo check`
Expected: emits warnings for empty modules but compiles successfully. If `parse` / `payload` "file not found" errors appear, that's expected — create them as empty files now:

```bash
touch src/parse.rs src/payload.rs
cargo check
```

Expected after touch: clean compile.

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml src/lib.rs src/parse.rs src/payload.rs
git commit -m "chore: scaffold Rust crate"
```

---

## Task 2: `parse_base64` — extract the encoded article id from a Google News URL

**Files:**
- Modify: `src/parse.rs`

- [ ] **Step 1: Write the failing tests**

Replace `src/parse.rs` contents with:

```rust
use url::Url;

pub fn parse_base64(input: &str) -> Result<String, &'static str> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_id_from_articles_url() {
        let url = "https://news.google.com/articles/CBMiABCDEF?hl=en-US&gl=US";
        assert_eq!(parse_base64(url).unwrap(), "CBMiABCDEF");
    }

    #[test]
    fn extracts_id_from_read_url() {
        let url = "https://news.google.com/read/CBMiXYZ123?hl=en-US";
        assert_eq!(parse_base64(url).unwrap(), "CBMiXYZ123");
    }

    #[test]
    fn rejects_wrong_host() {
        assert!(parse_base64("https://example.com/articles/CBMiABC").is_err());
    }

    #[test]
    fn rejects_unrelated_path() {
        assert!(parse_base64("https://news.google.com/topstories").is_err());
    }

    #[test]
    fn rejects_malformed_url() {
        assert!(parse_base64("not a url").is_err());
    }
}
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cargo test --lib parse::tests`
Expected: tests panic on `todo!()` (all 5 fail).

- [ ] **Step 3: Implement `parse_base64`**

Replace the `todo!()` body in `src/parse.rs`:

```rust
pub fn parse_base64(input: &str) -> Result<String, &'static str> {
    let url = Url::parse(input).map_err(|_| "invalid url")?;
    if url.host_str() != Some("news.google.com") {
        return Err("not a news.google.com url");
    }
    let segments: Vec<&str> = url
        .path_segments()
        .ok_or("no path segments")?
        .filter(|s| !s.is_empty())
        .collect();
    if segments.len() < 2 {
        return Err("path too short");
    }
    let parent = segments[segments.len() - 2];
    if parent != "articles" && parent != "read" {
        return Err("not an articles/read path");
    }
    Ok(segments[segments.len() - 1].to_string())
}
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `cargo test --lib parse::tests`
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/parse.rs
git commit -m "feat: parse base64 article id from Google News URL"
```

---

## Task 3: `extract_decoding_params` — pull `data-n-a-sg` / `data-n-a-ts` from HTML

**Files:**
- Modify: `src/parse.rs`

- [ ] **Step 1: Write the failing tests**

Append to `src/parse.rs` (above the `#[cfg(test)] mod tests` block):

```rust
#[derive(Debug, PartialEq, Eq)]
pub struct DecodingParams {
    pub signature: String,
    pub timestamp: String,
}

pub fn extract_decoding_params(_html: &str) -> Option<DecodingParams> {
    todo!()
}
```

Append inside the `mod tests` block (before its closing brace):

```rust
    #[test]
    fn extract_params_returns_attrs_when_present() {
        let html = r#"
            <html><body>
            <c-wiz>
                <div jscontroller="abc" data-n-a-sg="SIG123" data-n-a-ts="1234567890">x</div>
            </c-wiz>
            </body></html>
        "#;
        assert_eq!(
            extract_decoding_params(html),
            Some(DecodingParams {
                signature: "SIG123".to_string(),
                timestamp: "1234567890".to_string(),
            })
        );
    }

    #[test]
    fn extract_params_returns_none_when_div_missing() {
        let html = "<html><body><c-wiz></c-wiz></body></html>";
        assert!(extract_decoding_params(html).is_none());
    }

    #[test]
    fn extract_params_returns_none_when_attrs_missing() {
        let html = r#"<c-wiz><div jscontroller="abc">no attrs</div></c-wiz>"#;
        assert!(extract_decoding_params(html).is_none());
    }
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cargo test --lib parse::tests::extract`
Expected: 3 tests panic on `todo!()`.

- [ ] **Step 3: Implement `extract_decoding_params`**

Replace the `todo!()` body:

```rust
pub fn extract_decoding_params(html: &str) -> Option<DecodingParams> {
    let dom = tl::parse(html, tl::ParserOptions::default()).ok()?;
    let parser = dom.parser();
    for handle in dom.query_selector("div[jscontroller]")? {
        let node = handle.get(parser)?;
        let tag = node.as_tag()?;
        let attrs = tag.attributes();
        let sg = attrs.get("data-n-a-sg").flatten();
        let ts = attrs.get("data-n-a-ts").flatten();
        if let (Some(sg), Some(ts)) = (sg, ts) {
            return Some(DecodingParams {
                signature: sg.as_utf8_str().to_string(),
                timestamp: ts.as_utf8_str().to_string(),
            });
        }
    }
    None
}
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `cargo test --lib parse::tests`
Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/parse.rs
git commit -m "feat: extract decoding params from Google News HTML"
```

---

## Task 4: `parse_batchexecute_response` — extract the decoded URL from Google's response body

**Files:**
- Modify: `src/parse.rs`

- [ ] **Step 1: Write the failing tests**

Append to `src/parse.rs` (above the `#[cfg(test)]` block):

```rust
pub fn parse_batchexecute_response(_body: &str) -> Option<String> {
    todo!()
}
```

Append inside `mod tests`:

```rust
    #[test]
    fn parse_batchexecute_extracts_url() {
        let body = "ignored-prelude\n\n[[null,null,\"[\\\"x\\\",\\\"https://example.com/article\\\"]\"],\"trail1\",\"trail2\"]";
        assert_eq!(
            parse_batchexecute_response(body).unwrap(),
            "https://example.com/article"
        );
    }

    #[test]
    fn parse_batchexecute_returns_none_on_garbage() {
        assert!(parse_batchexecute_response("garbage").is_none());
    }

    #[test]
    fn parse_batchexecute_returns_none_on_invalid_second_chunk() {
        assert!(parse_batchexecute_response("a\n\nnot-json").is_none());
    }

    #[test]
    fn parse_batchexecute_returns_none_on_unexpected_shape() {
        // Outer JSON parses, but the inner [0][2] string isn't valid JSON.
        let body = "a\n\n[[null,null,\"not-json-inside\"],\"x\",\"y\"]";
        assert!(parse_batchexecute_response(body).is_none());
    }
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cargo test --lib parse::tests::parse_batchexecute`
Expected: 4 tests panic on `todo!()`.

- [ ] **Step 3: Implement `parse_batchexecute_response`**

Replace the `todo!()` body:

```rust
pub fn parse_batchexecute_response(body: &str) -> Option<String> {
    let mut parts = body.split("\n\n");
    parts.next()?;
    let second = parts.next()?;
    let outer: serde_json::Value = serde_json::from_str(second).ok()?;
    let arr = outer.as_array()?;
    if arr.len() < 3 {
        return None;
    }
    let first = arr.first()?.as_array()?;
    let nested_str = first.get(2)?.as_str()?;
    let inner: serde_json::Value = serde_json::from_str(nested_str).ok()?;
    let url = inner.as_array()?.get(1)?.as_str()?;
    Some(url.to_string())
}
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `cargo test --lib parse::tests`
Expected: all 12 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/parse.rs
git commit -m "feat: parse decoded URL from batchexecute response"
```

---

## Task 5: `build_batchexecute_payload` — construct the JSON body Google expects

**Files:**
- Modify: `src/payload.rs`

- [ ] **Step 1: Write the failing tests**

Replace `src/payload.rs` contents:

```rust
pub fn build_batchexecute_payload(_base64: &str, _signature: &str, _timestamp: &str) -> String {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_is_valid_json_with_expected_envelope() {
        let payload = build_batchexecute_payload("BASE64ID", "SIG123", "9999");
        let parsed: serde_json::Value = serde_json::from_str(&payload).expect("payload must be valid JSON");
        // Shape: [[["Fbv4je", "<inner json string>"]]]
        let inner = parsed[0][0][1]
            .as_str()
            .expect("inner element must be a JSON string");
        assert_eq!(parsed[0][0][0].as_str(), Some("Fbv4je"));
        assert!(inner.contains("\"BASE64ID\""));
        assert!(inner.contains("\"SIG123\""));
        assert!(inner.contains("9999"));
    }

    #[test]
    fn payload_inner_is_well_formed_json() {
        let payload = build_batchexecute_payload("B", "S", "1");
        let outer: serde_json::Value = serde_json::from_str(&payload).unwrap();
        let inner_str = outer[0][0][1].as_str().unwrap();
        let inner: serde_json::Value = serde_json::from_str(inner_str)
            .expect("inner string must itself be valid JSON");
        assert_eq!(inner[0].as_str(), Some("garturlreq"));
    }
}
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cargo test --lib payload`
Expected: both tests panic on `todo!()`.

- [ ] **Step 3: Implement `build_batchexecute_payload`**

Replace the `todo!()` body:

```rust
pub fn build_batchexecute_payload(base64: &str, signature: &str, timestamp: &str) -> String {
    let inner = format!(
        r#"["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"{}",{},"{}"]"#,
        base64, timestamp, signature
    );
    serde_json::json!([[["Fbv4je", inner]]]).to_string()
}
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `cargo test --lib payload`
Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/payload.rs
git commit -m "feat: build batchexecute payload"
```

---

## Task 6: Expose the four functions to JS via `#[wasm_bindgen]`

**Files:**
- Modify: `src/lib.rs`

- [ ] **Step 1: Replace `src/lib.rs` with the wasm-bindgen exports**

```rust
mod parse;
mod payload;

use js_sys::{Error, Reflect};
use wasm_bindgen::prelude::*;

fn throw(kind: &str, msg: &str) -> JsValue {
    let err = Error::new(msg);
    err.set_name("DecodeError");
    let obj: JsValue = err.into();
    let _ = Reflect::set(&obj, &JsValue::from_str("kind"), &JsValue::from_str(kind));
    obj
}

#[wasm_bindgen(js_name = parseBase64)]
pub fn parse_base64(url: &str) -> Result<String, JsValue> {
    parse::parse_base64(url).map_err(|msg| throw("invalid-url", msg))
}

#[wasm_bindgen]
pub struct DecodingParams {
    signature: String,
    timestamp: String,
}

#[wasm_bindgen]
impl DecodingParams {
    #[wasm_bindgen(getter)]
    pub fn signature(&self) -> String {
        self.signature.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn timestamp(&self) -> String {
        self.timestamp.clone()
    }
}

#[wasm_bindgen(js_name = extractDecodingParams)]
pub fn extract_decoding_params(html: &str) -> Result<DecodingParams, JsValue> {
    parse::extract_decoding_params(html)
        .map(|p| DecodingParams {
            signature: p.signature,
            timestamp: p.timestamp,
        })
        .ok_or_else(|| throw("params-missing", "data-n-a-sg / data-n-a-ts attributes not found"))
}

#[wasm_bindgen(js_name = buildBatchexecutePayload)]
pub fn build_batchexecute_payload(base64: &str, signature: &str, timestamp: &str) -> String {
    payload::build_batchexecute_payload(base64, signature, timestamp)
}

#[wasm_bindgen(js_name = parseBatchexecuteResponse)]
pub fn parse_batchexecute_response(body: &str) -> Result<String, JsValue> {
    parse::parse_batchexecute_response(body)
        .ok_or_else(|| throw("parse-failed", "could not parse batchexecute response"))
}
```

- [ ] **Step 2: Verify the host build still compiles**

Run: `cargo check`
Expected: clean compile (warnings for unused are fine).

- [ ] **Step 3: Build the WASM artifact**

Run: `wasm-pack build --target bundler --release`
Expected: produces `pkg/google_news_url_decoder.js`, `pkg/google_news_url_decoder_bg.wasm`, `pkg/google_news_url_decoder.d.ts`, `pkg/package.json`.

- [ ] **Step 4: Inspect the generated TypeScript declarations**

Run: `cat pkg/google_news_url_decoder.d.ts`
Expected: includes `parseBase64`, `extractDecodingParams`, `buildBatchexecutePayload`, `parseBatchexecuteResponse`, and the `DecodingParams` class.

- [ ] **Step 5: Commit**

```bash
git add src/lib.rs
git commit -m "feat: expose parsing helpers to JS via wasm-bindgen"
```

---

## Task 7: JS wrapper — `lib/decoder.mjs`, `index.mjs`, `index.workerd.mjs`, `package.json`

**Files:**
- Create: `lib/decoder.mjs` (shared logic)
- Create: `index.mjs` (default entry — nodejs target)
- Create: `index.workerd.mjs` (Cloudflare Workers entry — bundler target)
- Create: `index.d.ts`
- Create: `package.json`
- Modify: `.gitignore` (add `pkg-node/`)

- [ ] **Step 1: Write `package.json`**

Two `wasm-pack` builds are emitted: `pkg/` (bundler target, for Workers) and `pkg-node/` (nodejs target, for Node/Bun/Deno). The `exports` field uses the `workerd` condition (honored by wrangler) to route Workers to the bundler-target entry; everything else falls through to the default Node entry.

```json
{
  "name": "google-news-url-decoder",
  "version": "0.1.0",
  "description": "Decode Google News article share URLs to their original article URL.",
  "type": "module",
  "main": "./index.mjs",
  "types": "./index.d.ts",
  "exports": {
    ".": {
      "types": "./index.d.ts",
      "workerd": "./index.workerd.mjs",
      "default": "./index.mjs"
    }
  },
  "files": [
    "index.mjs",
    "index.workerd.mjs",
    "index.d.ts",
    "lib/decoder.mjs",
    "pkg/google_news_url_decoder_bg.wasm",
    "pkg/google_news_url_decoder.js",
    "pkg/google_news_url_decoder.d.ts",
    "pkg/google_news_url_decoder_bg.js",
    "pkg-node/google_news_url_decoder_bg.wasm",
    "pkg-node/google_news_url_decoder.js",
    "pkg-node/google_news_url_decoder.d.ts"
  ],
  "scripts": {
    "build:bundler": "wasm-pack build --target bundler --release --out-dir pkg",
    "build:node": "wasm-pack build --target nodejs --release --out-dir pkg-node",
    "build": "npm run build:bundler && npm run build:node",
    "test:unit": "cargo test",
    "test:int": "node --test test/decode.test.mjs",
    "test:e2e": "RUN_E2E=1 node --test test/e2e.test.mjs",
    "test": "npm run test:unit && npm run build && npm run test:int"
  },
  "engines": {
    "node": ">=18"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/daeuk1011/google-news-url-decoder.git"
  },
  "license": "MIT"
}
```

Also extend `.gitignore`:

```bash
printf 'pkg-node/\n' >> .gitignore
```

- [ ] **Step 2: Write `index.d.ts`**

```typescript
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
```

- [ ] **Step 3: Write `lib/decoder.mjs` (shared orchestration logic)**

```javascript
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
```

- [ ] **Step 4: Write `index.mjs` (default entry, nodejs target)**

```javascript
import * as wasm from "./pkg-node/google_news_url_decoder.js";
import { makeDecoder } from "./lib/decoder.mjs";

const { decode, DecodeError } = makeDecoder(wasm);

export { decode, DecodeError };
```

- [ ] **Step 5: Write `index.workerd.mjs` (Workers entry, bundler target)**

```javascript
import * as wasm from "./pkg/google_news_url_decoder.js";
import { makeDecoder } from "./lib/decoder.mjs";

const { decode, DecodeError } = makeDecoder(wasm);

export { decode, DecodeError };
```

- [ ] **Step 6: Build both WASM targets**

Run: `npm run build`
Expected: produces both `pkg/` and `pkg-node/`.

- [ ] **Step 7: Commit**

```bash
git add package.json index.mjs index.workerd.mjs index.d.ts lib/ .gitignore
git commit -m "feat: JS wrapper with decode() orchestration and DecodeError"
```

---

## Task 8: Node integration test scaffolding + happy path

**Files:**
- Create: `test/decode.test.mjs`
- Create: `test/fixtures.mjs`

Tests import directly from `../index.mjs` because that file uses the nodejs-target WASM build, which runs in bare Node without a bundler.

- [ ] **Step 1: Write `test/fixtures.mjs` with the canned Google responses**

```javascript
export const VALID_HTML = `
<html><body>
  <c-wiz>
    <div jscontroller="abc" data-n-a-sg="TESTSIG" data-n-a-ts="1700000000">x</div>
  </c-wiz>
</body></html>
`;

export const VALID_BATCH_RESPONSE =
  ")]}'\n\n" +
  '[[null,null,"[\\"x\\",\\"https://example.com/article\\"]"],"trail1","trail2"]';

export const HTML_WITHOUT_PARAMS = "<html><body><c-wiz></c-wiz></body></html>";

export const MALFORMED_BATCH_RESPONSE = "garbage";

export const VALID_NEWS_URL =
  "https://news.google.com/articles/CBMiTESTBASE64?hl=en-US&gl=US&ceid=US%3Aen";

export function makeFetchMock(responses) {
  // responses: array of { match: (url) => boolean, ok?, status?, text? }
  return async (url, _init) => {
    for (const r of responses) {
      if (r.match(url)) {
        return {
          ok: r.ok ?? true,
          status: r.status ?? 200,
          text: async () => r.text ?? "",
        };
      }
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
}
```

- [ ] **Step 2: Write the failing happy-path test**

Create `test/decode.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { decode, DecodeError } from "../index.mjs";
import {
  VALID_HTML,
  VALID_BATCH_RESPONSE,
  VALID_NEWS_URL,
  makeFetchMock,
} from "./fixtures.mjs";

test("happy path: articles + batchexecute succeed", async () => {
  const fetchMock = makeFetchMock([
    { match: (u) => u.includes("/articles/"), text: VALID_HTML },
    { match: (u) => u.includes("/batchexecute"), text: VALID_BATCH_RESPONSE },
  ]);
  const url = await decode(VALID_NEWS_URL, { fetch: fetchMock });
  assert.equal(url, "https://example.com/article");
});
```

- [ ] **Step 3: Build WASM (both targets) and run the test**

Run: `npm run build && node --test test/decode.test.mjs`
Expected: the happy path test PASSES (the JS wrapper from Task 7 should already implement the full happy flow).

If it fails, the failure points at a real defect in Task 7's `lib/decoder.mjs` — fix there, don't paper over it in tests.

- [ ] **Step 4: Commit**

```bash
git add test/decode.test.mjs test/fixtures.mjs
git commit -m "test: happy path integration test for decode()"
```

---

## Task 9: Fallback test — `/articles` fails, `/rss/articles` succeeds

**Files:**
- Modify: `test/decode.test.mjs`

- [ ] **Step 1: Append the fallback test**

Add to `test/decode.test.mjs`:

```javascript
test("falls back to /rss/articles when /articles fails at the network layer", async () => {
  const fetchMock = makeFetchMock([
    { match: (u) => u.includes("/articles/") && !u.includes("/rss/"), ok: false, status: 503 },
    { match: (u) => u.includes("/rss/articles/"), text: VALID_HTML },
    { match: (u) => u.includes("/batchexecute"), text: VALID_BATCH_RESPONSE },
  ]);
  const url = await decode(VALID_NEWS_URL, { fetch: fetchMock });
  assert.equal(url, "https://example.com/article");
});
```

- [ ] **Step 2: Run the tests**

Run: `node --test test/decode.test.mjs`
Expected: both tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/decode.test.mjs
git commit -m "test: /articles → /rss/articles fallback"
```

---

## Task 10: Error scenario tests — fetch-failed, params-missing, parse-failed

**Files:**
- Modify: `test/decode.test.mjs`

- [ ] **Step 1: Append the error tests**

```javascript
import { HTML_WITHOUT_PARAMS, MALFORMED_BATCH_RESPONSE } from "./fixtures.mjs";

test("both /articles and /rss/articles fail → fetch-failed", async () => {
  const fetchMock = makeFetchMock([
    { match: (u) => u.includes("/articles/"), ok: false, status: 503 },
  ]);
  await assert.rejects(
    () => decode(VALID_NEWS_URL, { fetch: fetchMock }),
    (err) => err instanceof DecodeError && err.kind === "fetch-failed",
  );
});

test("/articles returns 200 but HTML has no params → params-missing (no fallback)", async () => {
  let rssCalls = 0;
  const fetchMock = async (u) => {
    if (u.includes("/rss/")) {
      rssCalls += 1;
      return { ok: true, status: 200, text: async () => "" };
    }
    if (u.includes("/articles/")) {
      return { ok: true, status: 200, text: async () => HTML_WITHOUT_PARAMS };
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  await assert.rejects(
    () => decode(VALID_NEWS_URL, { fetch: fetchMock }),
    (err) => err instanceof DecodeError && err.kind === "params-missing",
  );
  assert.equal(rssCalls, 0, "RSS fallback must not be invoked when primary succeeded but lacked attrs");
});

test("batchexecute returns malformed body → parse-failed", async () => {
  const fetchMock = makeFetchMock([
    { match: (u) => u.includes("/articles/"), text: VALID_HTML },
    { match: (u) => u.includes("/batchexecute"), text: MALFORMED_BATCH_RESPONSE },
  ]);
  await assert.rejects(
    () => decode(VALID_NEWS_URL, { fetch: fetchMock }),
    (err) => err instanceof DecodeError && err.kind === "parse-failed",
  );
});

test("invalid input URL → invalid-url", async () => {
  await assert.rejects(
    () => decode("https://example.com/", { fetch: async () => ({ ok: true, text: async () => "" }) }),
    (err) => err instanceof DecodeError && err.kind === "invalid-url",
  );
});
```

- [ ] **Step 2: Run the tests**

Run: `node --test test/decode.test.mjs`
Expected: all 6 tests pass. If `params-missing` fails because `extractDecodingParams` returned an empty params object instead of throwing, re-check the wasm-bindgen `Result` mapping in `src/lib.rs` (Task 6).

- [ ] **Step 3: Commit**

```bash
git add test/decode.test.mjs
git commit -m "test: error scenarios (fetch-failed, params-missing, parse-failed, invalid-url)"
```

---

## Task 11: AbortSignal propagation test

**Files:**
- Modify: `test/decode.test.mjs`

- [ ] **Step 1: Append the abort test**

```javascript
test("AbortSignal aborts mid-flight → fetch-failed with AbortError cause", async () => {
  const controller = new AbortController();
  const fetchMock = async (_url, init) => {
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      });
    });
  };
  queueMicrotask(() => controller.abort());
  await assert.rejects(
    () => decode(VALID_NEWS_URL, { fetch: fetchMock, signal: controller.signal }),
    (err) => err instanceof DecodeError && err.kind === "fetch-failed",
  );
});
```

- [ ] **Step 2: Run the tests**

Run: `node --test test/decode.test.mjs`
Expected: all 7 tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/decode.test.mjs
git commit -m "test: AbortSignal propagation"
```

---

## Task 12: Examples — Node + Cloudflare Workers

**Files:**
- Create: `examples/node.mjs`
- Create: `examples/workers.ts`

- [ ] **Step 1: Write `examples/node.mjs`**

```javascript
import { decode, DecodeError } from "../index.mjs";

const url =
  "https://news.google.com/read/CBMi2AFBVV95cUxPd1ZCc1loODVVNHpnbFFTVHFkTG94eWh1NWhTeE9yT1RyNTRXMVV2S1VIUFM3ZlVkVjl6UHh3RkJ0bXdaTVRlcHBjMWFWTkhvZWVuM3pBMEtEdlllRDBveGdIUm9GUnJ4ajd1YWR5cWs3VFA5V2dsZnY1RDZhVDdORHRSSE9EalF2TndWdlh4bkJOWU5UMTdIV2RCc285Q2p3MFA4WnpodUNqN1RNREMwa3d5T2ZHS0JlX0MySGZLc01kWDNtUEkzemtkbWhTZXdQTmdfU1JJaXY?hl=en-US&gl=US&ceid=US%3Aen";

try {
  const decoded = await decode(url);
  console.log("decoded:", decoded);
} catch (err) {
  if (err instanceof DecodeError) {
    console.error(`DecodeError [${err.kind}]:`, err.message);
  } else {
    throw err;
  }
}
```

- [ ] **Step 2: Write `examples/workers.ts`**

```typescript
import { decode, DecodeError } from "google-news-url-decoder";

export default {
  async fetch(request: Request): Promise<Response> {
    const target = new URL(request.url).searchParams.get("u");
    if (!target) return new Response("missing ?u=", { status: 400 });
    try {
      const decoded = await decode(target);
      return Response.json({ url: decoded });
    } catch (err) {
      if (err instanceof DecodeError) {
        return Response.json({ error: err.kind, message: err.message }, { status: 502 });
      }
      throw err;
    }
  },
};
```

- [ ] **Step 3: Commit**

```bash
git add examples/
git commit -m "docs: add Node and Cloudflare Workers examples"
```

---

## Task 13: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# google-news-url-decoder

Decode Google News article share URLs to their original article URL. Rust core, WebAssembly distribution.

Ported from [SSujitX/google-news-url-decoder](https://github.com/SSujitX/google-news-url-decoder) (Python).

## Install

```sh
npm install google-news-url-decoder
```

Requires a JS runtime with global `fetch`: Node.js 18+, Cloudflare Workers, Deno, Bun.

> **Browser is not supported.** `news.google.com` does not return CORS headers to third-party origins. Use this library from a server, Worker, or extension context instead.

## Usage

```js
import { decode, DecodeError } from "google-news-url-decoder";

try {
  const url = await decode("https://news.google.com/articles/CBMi...");
  console.log(url);
} catch (err) {
  if (err instanceof DecodeError) {
    console.error(err.kind, err.message);
  }
}
```

## Options

```ts
decode(url, {
  fetch,    // custom fetch implementation (default: globalThis.fetch)
  headers,  // extra headers (merged over default User-Agent)
  signal,   // AbortSignal forwarded to every fetch call
});
```

### Using a proxy (Node.js)

```js
import { fetch as undiciFetch, ProxyAgent } from "undici";
const dispatcher = new ProxyAgent("http://user:pass@host:8080");
const fetch = (url, init) => undiciFetch(url, { ...init, dispatcher });

const decoded = await decode(googleUrl, { fetch });
```

## Error model

All failures throw `DecodeError`. Branch on `err.kind`:

| `kind` | Cause |
|---|---|
| `invalid-url` | Input is not a recognized Google News article URL. |
| `fetch-failed` | A `fetch` call rejected, returned a non-2xx status, or its body could not be read. |
| `params-missing` | Google returned HTML without the expected `data-n-a-sg` / `data-n-a-ts` attributes. |
| `parse-failed` | The `batchexecute` response did not match the expected nested-JSON shape (likely an upstream format change). |

## Runtime support

| Runtime | Supported | Notes |
|---|---|---|
| Node.js 18+ | ✅ | Uses global `fetch`. |
| Cloudflare Workers | ✅ | See `examples/workers.ts`. |
| Deno | ✅ | |
| Bun | ✅ | |
| Browser | ❌ | CORS blocks direct calls to `news.google.com`. |

## License

MIT.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README"
```

---

## Task 14: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the CI workflow**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy
          targets: wasm32-unknown-unknown
      - name: Install wasm-pack
        run: curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

      - name: cargo fmt
        run: cargo fmt --check
      - name: cargo clippy
        run: cargo clippy --all-targets -- -D warnings
      - name: cargo test
        run: cargo test
      - name: wasm-pack build (bundler target, for distribution)
        run: wasm-pack build --target bundler --release --out-dir pkg
      - name: wasm-pack build (nodejs target, for tests)
        run: wasm-pack build --target nodejs --release --out-dir pkg-node
      - name: bundle size check
        run: |
          size=$(gzip -c pkg/google_news_url_decoder_bg.wasm | wc -c)
          echo "gzipped wasm size: $size bytes"
          if [ "$size" -gt 102400 ]; then
            echo "::error::wasm exceeds 100 KB gzipped ($size bytes)"
            exit 1
          fi
      - name: node integration tests
        run: node --test test/decode.test.mjs
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add fmt + clippy + cargo test + wasm build + integration tests"
```

---

## Task 15: E2E smoke test (weekly + manual)

**Files:**
- Create: `test/e2e.test.mjs`
- Create: `.github/workflows/e2e.yml`

- [ ] **Step 1: Write `test/e2e.test.mjs`**

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { decode } from "../index.mjs";

const RUN_E2E = process.env.RUN_E2E === "1";

test("e2e: decodes a real Google News URL", { skip: !RUN_E2E }, async () => {
  // A long-lived Google News URL. If Google rotates these, update this fixture.
  const url =
    "https://news.google.com/rss/articles/CBMiVkFVX3lxTE4zaGU2bTY2ZGkzdTRkSkJ0cFpsTGlDUjkxU2FBRURaTWU0c3QzVWZ1MHZZNkZ5Vzk1ZVBnTDFHY2R6ZmdCUkpUTUJsS1pqQTlCRzlzbHV3?oc=5";
  const decoded = await decode(url);
  assert.ok(decoded.startsWith("http"), `expected an http(s) URL, got: ${decoded}`);
});
```

- [ ] **Step 2: Write the weekly workflow**

Create `.github/workflows/e2e.yml`:

```yaml
name: E2E

on:
  schedule:
    - cron: "0 7 * * 1"   # Mondays 07:00 UTC
  workflow_dispatch:

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: wasm32-unknown-unknown
      - name: Install wasm-pack
        run: curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
      - name: build wasm (nodejs target for E2E)
        run: wasm-pack build --target nodejs --release --out-dir pkg-node
      - name: e2e
        env:
          RUN_E2E: "1"
        run: node --test test/e2e.test.mjs
```

- [ ] **Step 3: Verify the test is skipped when the env var is not set**

Run: `node --test test/e2e.test.mjs`
Expected: 1 test reported as skipped, suite passes.

- [ ] **Step 4: Commit**

```bash
git add test/e2e.test.mjs .github/workflows/e2e.yml
git commit -m "test: weekly E2E smoke against real Google News"
```

---

## Done state

After Task 15:

- `cargo test` passes (all parsing unit tests).
- `wasm-pack build --target bundler --release` produces a < 100 KB gzipped `.wasm`.
- `node --test test/decode.test.mjs` passes 7 integration tests covering happy path, fallback, all four `DecodeError.kind` values, and `AbortSignal`.
- `npm publish --dry-run` shows `index.mjs`, `index.workerd.mjs`, `index.d.ts`, `lib/decoder.mjs`, and both the `pkg/` and `pkg-node/` artifacts being included.
- A weekly GitHub Actions run catches Google API format drift via the E2E smoke.
