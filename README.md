# google-news-url-decoder

Decode Google News article share URLs to their original article URL. Rust core, WebAssembly distribution.

Ported from [SSujitX/google-news-url-decoder](https://github.com/SSujitX/google-news-url-decoder) (Python).

## Install

```sh
npm install @daeuk1011/google-news-url-decoder
```

Requires a JS runtime with global `fetch`: Node.js 18+, Cloudflare Workers, Deno, Bun.

> **Browser is not supported.** `news.google.com` does not return CORS headers to third-party origins. Use this library from a server, Worker, or extension context instead.

## Usage

```js
import { decode, DecodeError } from "@daeuk1011/google-news-url-decoder";

try {
  const url = await decode("https://news.google.com/articles/CBMi...");
  console.log(url);
} catch (err) {
  if (err instanceof DecodeError) {
    console.error(err.kind, err.message);
  }
}
```

## Decoding many URLs

`decodeBatch` decodes a list of URLs and collapses the final decode step into batched
`batchexecute` POSTs — one request per `batchSize` URLs instead of one per URL. This
sharply cuts the request volume on the rate-limited endpoint. Per-URL failures are
isolated: results are returned in input order, each either `{ url, decoded }` or
`{ url, error }`.

```js
import { decodeBatch } from "@daeuk1011/google-news-url-decoder";

const results = await decodeBatch(urls, { batchSize: 50, concurrency: 20 });

for (const r of results) {
  if (r.decoded) console.log(r.decoded);
  else console.error(r.url, r.error.kind);
}
```

> A per-article params GET is still required for each URL (the signature is per-article),
> so at scale you still want a rotating proxy pool — batching only reduces the POST volume.

## Options

```ts
decode(url, {
  fetch,    // custom fetch implementation (default: globalThis.fetch)
  headers,  // extra headers (merged over default User-Agent)
  signal,   // AbortSignal forwarded to every fetch call
});

decodeBatch(urls, {
  fetch, headers, signal,  // same as decode
  batchSize,  // URLs per batchexecute POST (default 50; server tolerates 150+)
  concurrency, // max concurrent param GETs in flight (default 20)
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
| `rate-limited` | Google throttled the request (HTTP 429 or a redirect to its `/sorry/` abuse page). Back off and retry, ideally from a different IP. |
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
