pub fn build_batchexecute_payload(base64: &str, signature: &str, timestamp: &str) -> String {
    let inner = format!(
        r#"["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"{}",{},"{}"]"#,
        base64, timestamp, signature
    );
    serde_json::json!([[["Fbv4je", inner]]]).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_is_valid_json_with_expected_envelope() {
        let payload = build_batchexecute_payload("BASE64ID", "SIG123", "9999");
        let parsed: serde_json::Value = serde_json::from_str(&payload).expect("payload must be valid JSON");
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
        let inner: serde_json::Value = serde_json::from_str(inner_str)
            .expect("inner string must itself be valid JSON");
        assert_eq!(inner[0].as_str(), Some("garturlreq"));
    }
}
