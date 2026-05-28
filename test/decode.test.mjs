import { test } from "node:test";
import assert from "node:assert/strict";
import { decode, DecodeError } from "../index.mjs";
import {
  HTML_WITHOUT_PARAMS,
  MALFORMED_BATCH_RESPONSE,
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

test("falls back to /rss/articles when /articles fails at the network layer", async () => {
  const fetchMock = makeFetchMock([
    { match: (u) => u.includes("/articles/") && !u.includes("/rss/"), ok: false, status: 503 },
    { match: (u) => u.includes("/rss/articles/"), text: VALID_HTML },
    { match: (u) => u.includes("/batchexecute"), text: VALID_BATCH_RESPONSE },
  ]);
  const url = await decode(VALID_NEWS_URL, { fetch: fetchMock });
  assert.equal(url, "https://example.com/article");
});

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
