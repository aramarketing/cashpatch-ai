use reqwest::Url;

pub fn allow_account_control(url: &str) -> Result<(), String> {
  let parsed = Url::parse(url).map_err(|_| "Invalid network destination")?;
  if parsed.scheme() != "https" {
    return Err("Account-control traffic must use HTTPS".to_string());
  }
  if parsed.host_str() != Some("cashpatch-ai.vercel.app") {
    return Err("Blocked network destination".to_string());
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
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn blocks_unknown_cloud_hosts() {
    assert!(allow_account_control("https://cashpatch-ai.vercel.app/api/desktop/entitlement").is_ok());
    assert!(allow_account_control("https://example.com/upload").is_err());
    assert!(allow_account_control("http://cashpatch-ai.vercel.app/api/desktop/entitlement").is_err());
  }

  #[test]
  fn local_ai_is_loopback_only() {
    assert!(allow_local_ai("http://127.0.0.1:11434/api/tags").is_ok());
    assert!(allow_local_ai("http://localhost:1234/v1/models").is_ok());
    assert!(allow_local_ai("https://api.openai.com/v1/models").is_err());
  }
}
