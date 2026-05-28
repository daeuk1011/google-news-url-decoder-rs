use url::Url;

pub fn parse_base64(input: &str) -> Result<String, &'static str> {
    let url = Url::parse(input).map_err(|_| "invalid url")?;
    if url.host_str() != Some("news.google.com") {
        return Err("not a news.google.com url");
    }
    let segments: Vec<&str> = url
        .path_segments()
        .ok_or("no path segments")?
        .filter(|s| !s.is_empty())
        .collect();
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

pub fn extract_decoding_params(html: &str) -> Option<DecodingParams> {
    let dom = tl::parse(html, tl::ParserOptions::default()).ok()?;
    let parser = dom.parser();
    for handle in dom.query_selector("div[jscontroller]")? {
        let node = handle.get(parser)?;
        let tag = node.as_tag()?;
        let attrs = tag.attributes();
        let sg = attrs.get("data-n-a-sg").flatten();
        let ts = attrs.get("data-n-a-ts").flatten();
        if let (Some(sg), Some(ts)) = (sg, ts) {
            return Some(DecodingParams {
                signature: sg.try_as_utf8_str()?.to_string(),
                timestamp: ts.try_as_utf8_str()?.to_string(),
            });
        }
    }
    None
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
}
