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
