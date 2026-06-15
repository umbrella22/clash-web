use anyhow::Result;
use serde_yaml::Value;
use std::collections::HashMap;

pub fn apply_merge(base: &str, merge_content: &str) -> Result<String> {
    let mut base_yaml: Value = serde_yaml::from_str(base)?;
    let merge_yaml: Value = serde_yaml::from_str(merge_content)?;

    if let Value::Mapping(ref mut base_map) = base_yaml {
        if let Value::Mapping(merge_map) = merge_yaml {
            let prepend_keys = ["prepend-rules", "prepend-proxies", "prepend-proxy-groups"];
            let append_keys = ["append-rules", "append-proxies", "append-proxy-groups"];

            for key in &prepend_keys {
                if let Some(Value::Sequence(prepend_items)) =
                    merge_map.get(&Value::String(key.to_string()))
                {
                    let base_key = key.trim_start_matches("prepend-");
                    if let Some(Value::Sequence(base_items)) =
                        base_map.get_mut(&Value::String(base_key.to_string()))
                    {
                        let mut new_items = prepend_items.clone();
                        new_items.append(base_items);
                        *base_items = new_items;
                    }
                }
            }

            for key in &append_keys {
                if let Some(Value::Sequence(append_items)) =
                    merge_map.get(&Value::String(key.to_string()))
                {
                    let base_key = key.trim_start_matches("append-");
                    if let Some(Value::Sequence(base_items)) =
                        base_map.get_mut(&Value::String(base_key.to_string()))
                    {
                        base_items.extend(append_items.clone());
                    }
                }
            }

            let skip_keys: HashMap<&str, bool> = [
                ("prepend-rules", true),
                ("prepend-proxies", true),
                ("prepend-proxy-groups", true),
                ("append-rules", true),
                ("append-proxies", true),
                ("append-proxy-groups", true),
            ]
            .into_iter()
            .collect();

            for (k, v) in merge_map {
                if let Value::String(ref key_str) = k {
                    if !skip_keys.contains_key(key_str.as_str()) {
                        base_map.insert(k, v);
                    }
                }
            }
        }
    }

    let result = serde_yaml::to_string(&base_yaml)?;
    Ok(result)
}

pub fn build_runtime_config(profile_content: &str, merge_profiles: &[String]) -> Result<String> {
    let mut config = profile_content.to_string();

    for merge_content in merge_profiles {
        config = apply_merge(&config, merge_content)?;
    }

    ensure_runtime_defaults(&config)
}

pub fn ensure_runtime_defaults(runtime_config: &str) -> Result<String> {
    let mut runtime_yaml: Value = serde_yaml::from_str(runtime_config)?;
    let Value::Mapping(ref mut runtime_map) = runtime_yaml else {
        anyhow::bail!("Runtime config must be a YAML mapping");
    };

    runtime_map
        .entry(Value::String("external-controller".to_string()))
        .or_insert(Value::String("127.0.0.1:9090".to_string()));

    Ok(serde_yaml::to_string(&runtime_yaml)?)
}

pub fn apply_dns_config(runtime_config: &str, dns_config: &str) -> Result<String> {
    let mut runtime_yaml: Value = serde_yaml::from_str(runtime_config)?;
    let dns_yaml = validate_dns_config(dns_config)?;

    let Value::Mapping(ref mut runtime_map) = runtime_yaml else {
        anyhow::bail!("Runtime config must be a YAML mapping");
    };

    runtime_map.insert(Value::String("dns".to_string()), dns_yaml);
    Ok(serde_yaml::to_string(&runtime_yaml)?)
}

pub fn build_runtime_config_with_dns(
    profile_content: &str,
    merge_profiles: &[String],
    dns_config: Option<&str>,
) -> Result<String> {
    let config = build_runtime_config(profile_content, merge_profiles)?;
    if let Some(dns_config) = dns_config {
        apply_dns_config(&config, dns_config)
    } else {
        Ok(config)
    }
}

pub fn validate_dns_config(content: &str) -> Result<Value> {
    let value: Value = serde_yaml::from_str(content)?;
    if !matches!(value, Value::Mapping(_)) {
        anyhow::bail!("DNS config must be a YAML mapping");
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_config_includes_external_controller_default() {
        let config = build_runtime_config("proxies: []\nrules:\n  - MATCH,DIRECT\n", &[]).unwrap();

        assert!(config.contains("external-controller: 127.0.0.1:9090"));
    }
}
