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
}
