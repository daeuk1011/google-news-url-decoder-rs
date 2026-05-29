# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1]

### Changed
- **Smaller install** — dropped the `url`, `tl`, and (unused) `urlencoding` Rust crates in
  favor of lightweight hand-rolled URL/attribute parsing. The `url` crate's IDNA unicode
  tables dominated the binary. Each WASM binary drops 307 KB → 121 KB; the package goes
  from ~651 KB to ~279 KB unpacked, with zero runtime dependencies. No API or behavior
  change (validated against real Google News HTML).

## [0.2.0]

### Added
- `decodeBatch(urls, opts)` — decode many URLs while collapsing the final decode step
  into batched `batchexecute` POSTs (one request per `batchSize` URLs instead of one per
  URL). Per-URL failures are isolated; results are returned in input order as
  `{ url, decoded }` or `{ url, error }`. Options: `batchSize` (default 50),
  `concurrency` for param-fetch GETs (default 20), plus the usual `fetch`/`headers`/`signal`.
- `rate-limited` `DecodeError` kind — Google throttling (HTTP 429 or a redirect to its
  `/sorry/` abuse page) is now surfaced distinctly from `fetch-failed` so callers can
  back off and retry. The `/articles/` → `/rss/articles/` param fallback also triggers
  on rate-limiting, since Google throttles the two paths independently.

## [0.1.0]

### Added
- Initial release: `decode(url, opts)` for single Google News article URLs, with a
  Rust core compiled to WebAssembly and `DecodeError` kinds `invalid-url`,
  `fetch-failed`, `params-missing`, `parse-failed`.
