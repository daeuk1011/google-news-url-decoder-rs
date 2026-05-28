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
