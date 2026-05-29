fn build_garturlreq(base64: &str, signature: &str, timestamp: &str) -> String {
    format!(
        r#"["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"{}",{},"{}"]"#,
        base64, timestamp, signature
    )
}

pub fn build_batchexecute_payload(base64: &str, signature: &str, timestamp: &str) -> String {
    let inner = build_garturlreq(base64, signature, timestamp);
    serde_json::json!([[["Fbv4je", inner]]]).to_string()
}

/// Build a multi-RPC batchexecute payload from a JSON array of `[base64, signature, timestamp]`
/// triples. Each RPC is tagged with a 1-based index string so results can be mapped back.
/// Shape: `[[["Fbv4je", "<inner>", null, "1"], ["Fbv4je", "<inner>", null, "2"], ...]]`
pub fn build_batchexecute_batch_payload(items_json: &str) -> Result<String, &'static str> {
    let items: Vec<Vec<String>> =
        serde_json::from_str(items_json).map_err(|_| "items must be a JSON array of triples")?;
    let mut envelopes: Vec<serde_json::Value> = Vec::with_capacity(items.len());
    for (i, item) in items.iter().enumerate() {
        if item.len() != 3 {
            return Err("each item must be [base64, signature, timestamp]");
        }
        let inner = build_garturlreq(&item[0], &item[1], &item[2]);
        envelopes.push(serde_json::json!([
            "Fbv4je",
            inner,
            serde_json::Value::Null,
            (i + 1).to_string()
        ]));
    }
    Ok(serde_json::Value::Array(vec![serde_json::Value::Array(envelopes)]).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_is_valid_json_with_expected_envelope() {
        let payload = build_batchexecute_payload("BASE64ID", "SIG123", "9999");
        let parsed: serde_json::Value =
            serde_json::from_str(&payload).expect("payload must be valid JSON");
        // Shape: [[["Fbv4je", "<inner json string>"]]]
        let inner = parsed[0][0][1]
            .as_str()
            .expect("inner element must be a JSON string");
        assert_eq!(parsed[0][0][0].as_str(), Some("Fbv4je"));
        assert!(inner.contains("\"BASE64ID\""));
        assert!(inner.contains("\"SIG123\""));
        assert!(inner.contains("9999"));
    }

    #[test]
    fn payload_inner_is_well_formed_json() {
        let payload = build_batchexecute_payload("B", "S", "1");
        let outer: serde_json::Value = serde_json::from_str(&payload).unwrap();
        let inner_str = outer[0][0][1].as_str().unwrap();
        let inner: serde_json::Value =
            serde_json::from_str(inner_str).expect("inner string must itself be valid JSON");
        assert_eq!(inner[0].as_str(), Some("garturlreq"));
    }

    #[test]
    fn batch_payload_wraps_each_item_with_index() {
        let items = r#"[["IDA","SGA","111"],["IDB","SGB","222"]]"#;
        let out = build_batchexecute_batch_payload(items).expect("valid items");
        let v: serde_json::Value = serde_json::from_str(&out).expect("payload must be valid JSON");
        // Shape: [[ ["Fbv4je", inner, null, "1"], ["Fbv4je", inner, null, "2"] ]]
        assert_eq!(v[0][0][0].as_str(), Some("Fbv4je"));
        assert_eq!(v[0][0][3].as_str(), Some("1"));
        assert_eq!(v[0][1][0].as_str(), Some("Fbv4je"));
        assert_eq!(v[0][1][3].as_str(), Some("2"));
        assert!(v[0][0][2].is_null());
        // each inner carries its own id + signature
        assert!(v[0][0][1].as_str().unwrap().contains("\"IDA\""));
        assert!(v[0][0][1].as_str().unwrap().contains("\"SGA\""));
        assert!(v[0][1][1].as_str().unwrap().contains("\"IDB\""));
        assert!(v[0][1][1].as_str().unwrap().contains("\"SGB\""));
    }

    #[test]
    fn batch_payload_inner_is_well_formed_garturlreq() {
        let out = build_batchexecute_batch_payload(r#"[["B","S","1"]]"#).unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        let inner: serde_json::Value = serde_json::from_str(v[0][0][1].as_str().unwrap()).unwrap();
        assert_eq!(inner[0].as_str(), Some("garturlreq"));
    }

    #[test]
    fn batch_payload_rejects_malformed_items() {
        assert!(build_batchexecute_batch_payload("not json").is_err());
        assert!(build_batchexecute_batch_payload(r#"[["only","two"]]"#).is_err());
    }
}
