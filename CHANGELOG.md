# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0]

### Added
- `decodeBatch(urls, opts)` — decode many URLs while collapsing the final decode step
  into batched `batchexecute` POSTs (one request per `batchSize` URLs instead of one per
  URL). Per-URL failures are isolated; results are returned in input order as
  `{ url, decoded }` or `{ url, error }`. Options: `batchSize` (default 50),
  `concurrency` for param-fetch GETs (default 20), plus the usual `fetch`/`headers`/`signal`.
- `rate-limited` `DecodeError` kind — Google throttling (HTTP 429 or a redirect to its
  `/sorry/` abuse page) is now surfaced distinctly from `fetch-failed` so callers can
  back off and retry.

## [0.1.0]

### Added
- Initial release: `decode(url, opts)` for single Google News article URLs, with a
  Rust core compiled to WebAssembly and `DecodeError` kinds `invalid-url`,
  `fetch-failed`, `params-missing`, `parse-failed`.
