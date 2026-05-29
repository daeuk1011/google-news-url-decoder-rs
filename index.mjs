import * as wasm from "./pkg-node/google_news_url_decoder.js";
import { makeDecoder } from "./lib/decoder.mjs";

const { decode, decodeBatch, DecodeError } = makeDecoder(wasm);

export { decode, decodeBatch, DecodeError };
