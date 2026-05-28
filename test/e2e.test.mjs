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
