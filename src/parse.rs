pub fn parse_base64(input: &str) -> Result<String, &'static str> {
    // Lightweight URL parse — avoids pulling in the `url` crate (and its large IDNA
    // unicode tables) just to read the host and path of a news.google.com URL.
    let after_scheme = input
        .split_once("://")
        .map(|(_, rest)| rest)
        .ok_or("invalid url")?;
    let host_end = after_scheme
        .find(['/', '?', '#'])
        .unwrap_or(after_scheme.len());
    // Strip optional userinfo and port before comparing the host.
    let host = after_scheme[..host_end]
        .rsplit('@')
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("");
    if !host.eq_ignore_ascii_case("news.google.com") {
        return Err("not a news.google.com url");
    }
    let path = after_scheme[host_end..]
        .split(['?', '#'])
        .next()
        .unwrap_or("");
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    if segments.len() < 2 {
        return Err("path too short");
    }
    let parent = segments[segments.len() - 2];
    if parent != "articles" && parent != "read" {
        return Err("not an articles/read path");
    }
    Ok(segments[segments.len() - 1].to_string())
}

#[derive(Debug, PartialEq, Eq)]
pub struct DecodingParams {
    pub signature: String,
    pub timestamp: String,
}

pub fn parse_batchexecute_response(body: &str) -> Option<String> {
    let mut parts = body.split("\n\n");
    parts.next()?;
    let second = parts.next()?;
    let outer: serde_json::Value = serde_json::from_str(second).ok()?;
    let arr = outer.as_array()?;
    if arr.len() < 3 {
        return None;
    }
    let first = arr.first()?.as_array()?;
    let nested_str = first.get(2)?.as_str()?;
    let inner: serde_json::Value = serde_json::from_str(nested_str).ok()?;
    let url = inner.as_array()?.get(1)?.as_str()?;
    Some(url.to_string())
}

/// Parse a multi-RPC batchexecute response into a JSON object mapping each RPC's
/// index string to its decoded URL, e.g. `{"1":"https://a","2":"https://b"}`.
/// Result frames look like `["wrb.fr","Fbv4je","<inner>",null,null,null,"<index>"]`
/// where `<inner>` is `["garturlres","<url>",1]`. Non-`wrb.fr` frames are ignored.
/// Returns `None` only when the response body is not parseable at all.
pub fn parse_batchexecute_batch_response(body: &str) -> Option<String> {
    let mut parts = body.split("\n\n");
    parts.next()?;
    let second = parts.next()?;
    let frames: serde_json::Value = serde_json::from_str(second).ok()?;
    let mut map = serde_json::Map::new();
    for frame in frames.as_array()? {
        let f = match frame.as_array() {
            Some(f) => f,
            None => continue,
        };
        if f.first().and_then(|v| v.as_str()) != Some("wrb.fr") {
            continue;
        }
        let index = match f.get(6).and_then(|v| v.as_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        let inner_str = match f.get(2).and_then(|v| v.as_str()) {
            Some(s) => s,
            None => continue,
        };
        let inner: serde_json::Value = match serde_json::from_str(inner_str) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(url) = inner
            .as_array()
            .and_then(|a| a.get(1))
            .and_then(|v| v.as_str())
        {
            map.insert(index, serde_json::Value::String(url.to_string()));
        }
    }
    Some(serde_json::Value::Object(map).to_string())
}

fn attr_value<'a>(html: &'a str, attr: &str) -> Option<&'a str> {
    // Find `attr="..."` and return the double-quoted value. Avoids pulling in a full
    // HTML parser just to read two attributes off the c-wiz element.
    let mut needle = String::with_capacity(attr.len() + 2);
    needle.push_str(attr);
    needle.push_str("=\"");
    let start = html.find(&needle)? + needle.len();
    let rest = &html[start..];
    let end = rest.find('"')?;
    Some(&rest[..end])
}

pub fn extract_decoding_params(html: &str) -> Option<DecodingParams> {
    let signature = attr_value(html, "data-n-a-sg")?.to_string();
    let timestamp = attr_value(html, "data-n-a-ts")?.to_string();
    Some(DecodingParams {
        signature,
        timestamp,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_id_from_articles_url() {
        let url = "https://news.google.com/articles/CBMiABCDEF?hl=en-US&gl=US";
        assert_eq!(parse_base64(url).unwrap(), "CBMiABCDEF");
    }

    #[test]
    fn extracts_id_from_read_url() {
        let url = "https://news.google.com/read/CBMiXYZ123?hl=en-US";
        assert_eq!(parse_base64(url).unwrap(), "CBMiXYZ123");
    }

    #[test]
    fn rejects_wrong_host() {
        assert!(parse_base64("https://example.com/articles/CBMiABC").is_err());
    }

    #[test]
    fn rejects_unrelated_path() {
        assert!(parse_base64("https://news.google.com/topstories").is_err());
    }

    #[test]
    fn rejects_malformed_url() {
        assert!(parse_base64("not a url").is_err());
    }

    #[test]
    fn extract_params_returns_attrs_when_present() {
        let html = r#"
            <html><body>
            <c-wiz>
                <div jscontroller="abc" data-n-a-sg="SIG123" data-n-a-ts="1234567890">x</div>
            </c-wiz>
            </body></html>
        "#;
        assert_eq!(
            extract_decoding_params(html),
            Some(DecodingParams {
                signature: "SIG123".to_string(),
                timestamp: "1234567890".to_string(),
            })
        );
    }

    #[test]
    fn extract_params_returns_none_when_div_missing() {
        let html = "<html><body><c-wiz></c-wiz></body></html>";
        assert!(extract_decoding_params(html).is_none());
    }

    #[test]
    fn extract_params_returns_none_when_attrs_missing() {
        let html = r#"<c-wiz><div jscontroller="abc">no attrs</div></c-wiz>"#;
        assert!(extract_decoding_params(html).is_none());
    }

    #[test]
    fn parse_batchexecute_extracts_url() {
        let body = "ignored-prelude\n\n[[null,null,\"[\\\"x\\\",\\\"https://example.com/article\\\"]\"],\"trail1\",\"trail2\"]";
        assert_eq!(
            parse_batchexecute_response(body).unwrap(),
            "https://example.com/article"
        );
    }

    #[test]
    fn parse_batchexecute_returns_none_on_garbage() {
        assert!(parse_batchexecute_response("garbage").is_none());
    }

    #[test]
    fn parse_batchexecute_returns_none_on_invalid_second_chunk() {
        assert!(parse_batchexecute_response("a\n\nnot-json").is_none());
    }

    #[test]
    fn parse_batchexecute_returns_none_on_unexpected_shape() {
        // Outer JSON parses, but the inner [0][2] string isn't valid JSON.
        let body = "a\n\n[[null,null,\"not-json-inside\"],\"x\",\"y\"]";
        assert!(parse_batchexecute_response(body).is_none());
    }

    // Mirrors the real batchexecute multi-RPC response shape, with indices
    // deliberately out of order to prove results are mapped by index, not position.
    const BATCH_BODY: &str = concat!(
        ")]}'\n\n",
        r#"[["wrb.fr","Fbv4je","[\"garturlres\",\"https://b.com/2\",1]",null,null,null,"2"],"#,
        r#"["wrb.fr","Fbv4je","[\"garturlres\",\"https://a.com/1\",1]",null,null,null,"1"],"#,
        r#"["di",12],["af.httprm",12,"-123",70]]"#
    );

    #[test]
    fn parse_batch_maps_each_result_by_index() {
        let json = parse_batchexecute_batch_response(BATCH_BODY).expect("parses");
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["1"].as_str(), Some("https://a.com/1"));
        assert_eq!(v["2"].as_str(), Some("https://b.com/2"));
    }

    #[test]
    fn parse_batch_ignores_non_result_frames() {
        let json = parse_batchexecute_batch_response(BATCH_BODY).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        // Only the two wrb.fr frames produce entries; di / af.httprm are skipped.
        assert_eq!(v.as_object().unwrap().len(), 2);
    }

    #[test]
    fn parse_batch_returns_none_on_garbage() {
        assert!(parse_batchexecute_batch_response("garbage").is_none());
    }
}
