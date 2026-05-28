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
