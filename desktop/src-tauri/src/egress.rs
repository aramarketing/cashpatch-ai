use reqwest::Url;

const ACCOUNT_CONTROL_PATHS: &[&str] = &[
  "/api/desktop/pair/start",
  "/api/desktop/pair/consume",
  "/api/desktop/entitlement",
  "/api/desktop/sources",
];

fn reject_embedded_credentials(parsed: &Url) -> Result<(), String> {
  if !parsed.username().is_empty() || parsed.password().is_some() {
    return Err("Embedded network credentials are not allowed".to_string());
  }
  if parsed.fragment().is_some() {
    return Err("Network destination fragments are not allowed".to_string());
  }
  Ok(())
}

fn require_cashpatch_https(parsed: &Url) -> Result<(), String> {
  if parsed.scheme() != "https" {
    return Err("CashPatch cloud traffic must use HTTPS".to_string());
  }
  if parsed.host_str() != Some("cashpatch-ai.vercel.app") {
    return Err("Blocked network destination".to_string());
  }
  if parsed.port_or_known_default() != Some(443) {
    return Err("CashPatch cloud traffic must use the standard HTTPS port".to_string());
  }
  reject_embedded_credentials(parsed)
}

pub fn allow_account_control(url: &str) -> Result<(), String> {
  let parsed = Url::parse(url).map_err(|_| "Invalid network destination")?;
  require_cashpatch_https(&parsed)?;

  if !ACCOUNT_CONTROL_PATHS.contains(&parsed.path()) {
    return Err("Blocked account-control path".to_string());
  }
  if parsed.query().is_some() {
    return Err("Account-control query parameters are not allowed".to_string());
  }

  Ok(())
}

#[allow(dead_code)]
pub fn allow_update_download(url: &str) -> Result<(), String> {
  let parsed = Url::parse(url).map_err(|_| "Invalid update destination")?;
  require_cashpatch_https(&parsed)?;

  if !parsed.path().starts_with("/api/desktop/update/") {
    return Err("Blocked update path".to_string());
  }

  Ok(())
}

pub fn allow_local_ai(url: &str) -> Result<(), String> {
  let parsed = Url::parse(url).map_err(|_| "Invalid local AI destination")?;
  let host = parsed.host_str().unwrap_or_default();
  if !matches!(host, "127.0.0.1" | "localhost" | "::1") {
    return Err("Local AI must use a loopback address".to_string());
  }
  if !matches!(parsed.scheme(), "http" | "https") {
    return Err("Unsupported local AI transport".to_string());
  }
  reject_embedded_credentials(&parsed)?;
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn account_control_allows_only_exact_review_only_endpoints() {
    for path in ACCOUNT_CONTROL_PATHS {
      assert!(allow_account_control(&format!("https://cashpatch-ai.vercel.app{path}")).is_ok());
    }

    assert!(allow_account_control("https://cashpatch-ai.vercel.app/api/desktop/banking/sync").is_err());
    assert!(allow_account_control("https://cashpatch-ai.vercel.app/api/import/csv").is_err());
    assert!(allow_account_control("https://cashpatch-ai.vercel.app/api/desktop/entitlement?upload=1").is_err());
    assert!(allow_account_control("https://example.com/upload").is_err());
    assert!(allow_account_control("http://cashpatch-ai.vercel.app/api/desktop/entitlement").is_err());
    assert!(allow_account_control("https://cashpatch-ai.vercel.app:444/api/desktop/entitlement").is_err());
    assert!(allow_account_control("https://user:secret@cashpatch-ai.vercel.app/api/desktop/entitlement").is_err());
  }

  #[test]
  fn update_policy_is_download_host_and_path_scoped() {
    assert!(allow_update_download("https://cashpatch-ai.vercel.app/api/desktop/update/darwin/aarch64/0.1.0").is_ok());
    assert!(allow_update_download("https://cashpatch-ai.vercel.app/api/desktop/pair/start").is_err());
    assert!(allow_update_download("https://evil.example/api/desktop/update/darwin/aarch64/0.1.0").is_err());
  }

  #[test]
  fn local_ai_is_loopback_only_without_embedded_credentials() {
    assert!(allow_local_ai("http://127.0.0.1:11434/api/tags").is_ok());
    assert!(allow_local_ai("http://localhost:1234/v1/models").is_ok());
    assert!(allow_local_ai("http://[::1]:8080/health").is_ok());
    assert!(allow_local_ai("https://api.openai.com/v1/models").is_err());
    assert!(allow_local_ai("http://user:secret@127.0.0.1:11434/api/tags").is_err());
  }
}
