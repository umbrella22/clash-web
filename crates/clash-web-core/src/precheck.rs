use anyhow::{Context, Result};
use serde_yaml::{Mapping, Value};
use std::collections::HashSet;

const BUILTIN_PROXY_NAMES: &[&str] = &["DIRECT", "REJECT", "REJECT-DROP", "PASS", "COMPATIBLE"];

pub fn validate_runtime_config(content: &str) -> Result<()> {
    let value: Value = serde_yaml::from_str(content).context("Runtime config is not valid YAML")?;
    let root = value
        .as_mapping()
        .context("Runtime config must be a YAML mapping")?;

    validate_sequence_field(root, "proxies")?;
    validate_sequence_field(root, "proxy-groups")?;
    validate_sequence_field(root, "rules")?;

    let proxy_names = collect_names(root, "proxies")?;
    let proxy_group_names = collect_names(root, "proxy-groups")?;
    validate_proxy_group_references(root, &proxy_names, &proxy_group_names)?;

    Ok(())
}

fn validate_sequence_field(root: &Mapping, key: &str) -> Result<()> {
    if let Some(value) = root.get(Value::String(key.to_string())) {
        if !value.is_sequence() {
            anyhow::bail!("Runtime config field `{}` must be a YAML sequence", key);
        }
    }

    Ok(())
}

fn collect_names(root: &Mapping, key: &str) -> Result<HashSet<String>> {
    let mut names = HashSet::new();
    let Some(Value::Sequence(items)) = root.get(Value::String(key.to_string())) else {
        return Ok(names);
    };

    for item in items {
        let item_map = item
            .as_mapping()
            .with_context(|| format!("Runtime config field `{}` entries must be mappings", key))?;
        let name = item_map
            .get(Value::String("name".to_string()))
            .and_then(Value::as_str)
            .with_context(|| {
                format!(
                    "Runtime config field `{}` entries must have string names",
                    key
                )
            })?;
        names.insert(name.to_string());
    }

    Ok(names)
}

fn validate_proxy_group_references(
    root: &Mapping,
    proxy_names: &HashSet<String>,
    proxy_group_names: &HashSet<String>,
) -> Result<()> {
    let Some(Value::Sequence(groups)) = root.get(Value::String("proxy-groups".to_string())) else {
        return Ok(());
    };
    let builtin_names: HashSet<&str> = BUILTIN_PROXY_NAMES.iter().copied().collect();

    for group in groups {
        let group_map = group
            .as_mapping()
            .context("Runtime config field `proxy-groups` entries must be mappings")?;
        let group_name = group_map
            .get(Value::String("name".to_string()))
            .and_then(Value::as_str)
            .context("Runtime config field `proxy-groups` entries must have string names")?;

        let Some(Value::Sequence(references)) = group_map.get(Value::String("proxies".to_string()))
        else {
            continue;
        };

        for reference in references {
            let reference_name = reference.as_str().with_context(|| {
                format!(
                    "Proxy group `{}` references must be string names",
                    group_name
                )
            })?;
            if builtin_names.contains(reference_name)
                || proxy_names.contains(reference_name)
                || proxy_group_names.contains(reference_name)
            {
                continue;
            }

            anyhow::bail!(
                "Proxy group `{}` references unknown proxy `{}`",
                group_name,
                reference_name
            );
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_runtime_config;

    #[test]
    fn accepts_runtime_config_with_valid_group_references() {
        let content = r#"
proxies:
  - name: HK
    type: ss
proxy-groups:
  - name: Auto
    type: select
    proxies:
      - HK
      - DIRECT
rules:
  - MATCH,DIRECT
"#;

        validate_runtime_config(content).unwrap();
    }

    #[test]
    fn rejects_invalid_yaml() {
        let error = validate_runtime_config("proxy-groups: [").unwrap_err();

        assert!(error.to_string().contains("valid YAML"));
    }

    #[test]
    fn rejects_non_mapping_runtime_config() {
        let error = validate_runtime_config("- DIRECT").unwrap_err();

        assert!(error.to_string().contains("YAML mapping"));
    }

    #[test]
    fn rejects_invalid_sequence_field_type() {
        let error = validate_runtime_config("proxies: bad\n").unwrap_err();

        assert!(error.to_string().contains("`proxies`"));
    }

    #[test]
    fn rejects_unknown_proxy_group_reference() {
        let content = r#"
proxies: []
proxy-groups:
  - name: Auto
    type: select
    proxies:
      - Missing
rules:
  - MATCH,DIRECT
"#;

        let error = validate_runtime_config(content).unwrap_err();

        assert!(error.to_string().contains("unknown proxy `Missing`"));
    }

    #[test]
    fn accepts_proxy_group_reference_to_another_group() {
        let content = r#"
proxies: []
proxy-groups:
  - name: Fallback
    type: select
    proxies:
      - DIRECT
  - name: Auto
    type: select
    proxies:
      - Fallback
rules:
  - MATCH,DIRECT
"#;

        validate_runtime_config(content).unwrap();
    }
}
