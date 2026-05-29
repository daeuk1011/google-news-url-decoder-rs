import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeBatch, DecodeError } from "../index.mjs";
import { VALID_HTML } from "./fixtures.mjs";

// Build a news.google.com article URL carrying a specific base64 id.
const newsUrl = (id) => `https://news.google.com/articles/${id}?hl=en-US&gl=US`;

// A fetch mock that:
//  - serves VALID_HTML for article GETs (so params extract to TESTSIG / 1700000000)
//  - on the batchexecute POST, reflects each RPC back as a decoded URL that embeds
//    its own base64 id, and returns the frames REVERSED to exercise index mapping.
// `postCalls` is mutated so tests can assert how many POSTs (chunks) were issued.
// Reflect each RPC in a batchexecute POST back as a decoded URL embedding its base64,
// returning the frames REVERSED to exercise index mapping.
function reflectBatchPost(init) {
  const reqBody = decodeURIComponent(init.body.replace(/^f\.req=/, ""));
  const envelopes = JSON.parse(reqBody)[0];
  const frames = envelopes.map((env) => {
    const index = env[3];
    const base64 = JSON.parse(env[1])[2];
    const inner = JSON.stringify(["garturlres", `https://decoded.example/${base64}`, 1]);
    return ["wrb.fr", "Fbv4je", inner, null, null, null, index];
  });
  frames.reverse();
  return { ok: true, status: 200, text: async () => ")]}'\n\n" + JSON.stringify(frames) };
}

function makeBatchFetchMock(postCalls) {
  return async (url, init = {}) => {
    if (url.includes("/articles/") && (init.method ?? "GET") === "GET") {
      return { ok: true, status: 200, text: async () => VALID_HTML };
    }
    if (url.includes("/batchexecute")) {
      postCalls.count = (postCalls.count ?? 0) + 1;
      return reflectBatchPost(init);
    }
    throw new Error(`unexpected fetch: ${url} ${init.method ?? "GET"}`);
  };
}

test("decodeBatch returns results aligned to input order", async () => {
  const postCalls = {};
  const urls = [newsUrl("CBMiAAA"), newsUrl("CBMiBBB"), newsUrl("CBMiCCC")];
  const results = await decodeBatch(urls, { fetch: makeBatchFetchMock(postCalls) });

  assert.equal(results.length, 3);
  assert.deepEqual(
    results.map((r) => r.decoded),
    [
      "https://decoded.example/CBMiAAA",
      "https://decoded.example/CBMiBBB",
      "https://decoded.example/CBMiCCC",
    ],
  );
  results.forEach((r, i) => assert.equal(r.url, urls[i]));
});

test("decodeBatch isolates a bad URL without failing the whole batch", async () => {
  const postCalls = {};
  const urls = [newsUrl("CBMiAAA"), "https://example.com/not-news", newsUrl("CBMiBBB")];
  const results = await decodeBatch(urls, { fetch: makeBatchFetchMock(postCalls) });

  assert.equal(results[0].decoded, "https://decoded.example/CBMiAAA");
  assert.equal(results[1].decoded, undefined);
  assert.ok(results[1].error instanceof DecodeError);
  assert.equal(results[1].error.kind, "invalid-url");
  assert.equal(results[2].decoded, "https://decoded.example/CBMiBBB");
});

test("decodeBatch caps concurrent param GETs at opts.concurrency", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const fetchMock = async (url, init = {}) => {
    if (url.includes("/articles/") && (init.method ?? "GET") === "GET") {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { ok: true, status: 200, text: async () => VALID_HTML };
    }
    if (url.includes("/batchexecute")) return reflectBatchPost(init);
    throw new Error(`unexpected fetch: ${url}`);
  };
  const urls = Array.from({ length: 12 }, (_, i) => newsUrl(`CBMi${i}`));
  const results = await decodeBatch(urls, { fetch: fetchMock, concurrency: 3 });

  assert.ok(maxInFlight <= 3, `expected <=3 concurrent GETs, saw ${maxInFlight}`);
  assert.equal(results.filter((r) => r.decoded).length, 12);
});

test("decodeBatch surfaces rate-limited when a batch POST is 429'd", async () => {
  const fetchMock = async (url, init = {}) => {
    if (url.includes("/articles/") && (init.method ?? "GET") === "GET") {
      return { ok: true, status: 200, text: async () => VALID_HTML };
    }
    if (url.includes("/batchexecute")) return { ok: false, status: 429, text: async () => "" };
    throw new Error(`unexpected fetch: ${url}`);
  };
  const results = await decodeBatch([newsUrl("CBMiAAA"), newsUrl("CBMiBBB")], { fetch: fetchMock });
  assert.ok(results.every((r) => r.error instanceof DecodeError && r.error.kind === "rate-limited"));
});

test("decodeBatch splits into multiple POSTs by batchSize", async () => {
  const postCalls = {};
  const urls = Array.from({ length: 5 }, (_, i) => newsUrl(`CBMi${i}`));
  const results = await decodeBatch(urls, { fetch: makeBatchFetchMock(postCalls), batchSize: 2 });

  assert.equal(postCalls.count, 3, "5 urls at batchSize 2 → 3 POSTs");
  assert.deepEqual(
    results.map((r) => r.decoded),
    [0, 1, 2, 3, 4].map((i) => `https://decoded.example/CBMi${i}`),
  );
});
