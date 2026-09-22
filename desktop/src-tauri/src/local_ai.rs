use crate::egress;
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

const MAX_INPUT_CHARS: usize = 12_000;
const MAX_TASK_CHARS: usize = 600;
const MAX_FINDINGS: usize = 24;
const MAX_FIELD_CHARS: usize = 900;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiModel {
  pub id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiFinding {
  pub category: String,
  pub severity: String,
  pub confidence: u8,
  pub title: String,
  pub summary: String,
  pub evidence: String,
  pub remediation: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiAnalysis {
  pub provider: String,
  pub model: String,
  pub input_truncated: bool,
  pub findings: Vec<LocalAiFinding>,
}

#[derive(Deserialize)]
struct OllamaTagsResponse {
  #[serde(default)]
  models: Vec<OllamaTagModel>,
}

#[derive(Deserialize)]
struct OllamaTagModel {
  name: String,
}

#[derive(Deserialize)]
struct OpenAiModelsResponse {
  #[serde(default)]
  data: Vec<OpenAiModel>,
}

#[derive(Deserialize)]
struct OpenAiModel {
  id: String,
}

#[derive(Deserialize)]
struct OllamaChatResponse {
  message: OllamaMessage,
}

#[derive(Deserialize)]
struct OllamaMessage {
  content: String,
}

#[derive(Deserialize)]
struct OpenAiChatResponse {
  #[serde(default)]
  choices: Vec<OpenAiChoice>,
}

#[derive(Deserialize)]
struct OpenAiChoice {
  message: OpenAiChoiceMessage,
}

#[derive(Deserialize)]
struct OpenAiChoiceMessage {
  content: String,
}

fn trim_chars(value: &str, max: usize) -> String {
  let mut output = value.chars().take(max + 1).collect::<String>();
  if output.chars().count() > max {
    output = output.chars().take(max).collect::<String>();
    output.push('…');
  }
  output
}

fn redact_token_like_words(value: &str) -> String {
  value
    .split_whitespace()
    .map(|word| {
      let trimmed = word.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_');
      let looks_secret = trimmed.len() >= 32
        && trimmed
          .chars()
          .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
      if looks_secret {
        "[REDACTED]".to_string()
      } else {
        word.to_string()
      }
    })
    .collect::<Vec<_>>()
    .join(" ")
}

fn sanitize_field(value: &str) -> String {
  trim_chars(&redact_token_like_words(value), MAX_FIELD_CHARS)
}

fn normalize_base_endpoint(provider: &str, custom_endpoint: Option<&str>) -> Result<Url, String> {
  let raw = match provider {
    "ollama" => "http://127.0.0.1:11434",
    "lm-studio" => "http://127.0.0.1:1234",
    "jev" | "custom-local" => custom_endpoint
      .map(str::trim)
      .filter(|value| !value.is_empty())
      .ok_or("A local endpoint is required for this provider")?,
    _ => return Err("Unsupported local AI provider".to_string()),
  };

  egress::allow_local_ai(raw)?;
  Url::parse(raw).map_err(|_| "Invalid local AI endpoint".to_string())
}

fn models_url(provider: &str, base: &Url) -> Result<Url, String> {
  let mut url = base.clone();
  match provider {
    "ollama" => url.set_path("/api/tags"),
    "lm-studio" | "jev" | "custom-local" => url.set_path("/v1/models"),
    _ => return Err("Unsupported local AI provider".to_string()),
  }
  url.set_query(None);
  url.set_fragment(None);
  egress::allow_local_ai(url.as_str())?;
  Ok(url)
}

fn chat_url(provider: &str, base: &Url) -> Result<Url, String> {
  let mut url = base.clone();
  match provider {
    "ollama" => url.set_path("/api/chat"),
    "lm-studio" | "jev" | "custom-local" => url.set_path("/v1/chat/completions"),
    _ => return Err("Unsupported local AI provider".to_string()),
  }
  url.set_query(None);
  url.set_fragment(None);
  egress::allow_local_ai(url.as_str())?;
  Ok(url)
}

fn system_prompt() -> &'static str {
  "You are the local CashPatch review-only audit model. Analyze only the supplied text. Never propose or perform external actions, tool calls, messages, payments, file modifications, credential use, or system changes. Return JSON only with key `findings`, an array. Each finding must contain: category, severity (info|low|medium|high|critical), confidence (0-100), title, summary, evidence, remediation. Evidence must be a short paraphrase and must never reproduce passwords, API keys, tokens, private keys, card data, session cookies, or other secrets. Remediation must describe a human action, never an action CashPatch should execute. If nothing meaningful is found return {\"findings\":[]}."
}

fn parse_findings(content: &str) -> Result<Vec<LocalAiFinding>, String> {
  let parsed: Value = serde_json::from_str(content).map_err(|_| "Local AI returned invalid JSON")?;
  let items = parsed
    .get("findings")
    .and_then(Value::as_array)
    .ok_or("Local AI JSON is missing findings")?;

  let mut findings = Vec::new();
  for item in items.iter().take(MAX_FINDINGS) {
    let category = item.get("category").and_then(Value::as_str).unwrap_or("general");
    let severity_raw = item.get("severity").and_then(Value::as_str).unwrap_or("info").to_ascii_lowercase();
    let severity = match severity_raw.as_str() {
      "info" | "low" | "medium" | "high" | "critical" => severity_raw,
      _ => "info".to_string(),
    };
    let confidence = item
      .get("confidence")
      .and_then(Value::as_u64)
      .unwrap_or(50)
      .min(100) as u8;

    let title = sanitize_field(item.get("title").and_then(Value::as_str).unwrap_or("Local AI review finding"));
    let summary = sanitize_field(item.get("summary").and_then(Value::as_str).unwrap_or(""));
    let mut evidence = sanitize_field(item.get("evidence").and_then(Value::as_str).unwrap_or(""));
    let evidence_lower = evidence.to_ascii_lowercase();
    if ["password", "passwort", "api key", "api-key", "access token", "refresh token", "private key", "session cookie"]
      .iter()
      .any(|needle| evidence_lower.contains(needle))
    {
      evidence = "Potential sensitive credential content detected; evidence redacted by CashPatch.".to_string();
    }
    let remediation = sanitize_field(item.get("remediation").and_then(Value::as_str).unwrap_or("Review the source manually."));

    findings.push(LocalAiFinding {
      category,
      severity,
      confidence,
      title,
      summary,
      evidence,
      remediation,
    });
  }

  Ok(findings)
}

#[tauri::command]
pub async fn local_ai_models(provider: String, endpoint: Option<String>) -> Result<Vec<LocalAiModel>, String> {
  let base = normalize_base_endpoint(&provider, endpoint.as_deref())?;
  let url = models_url(&provider, &base)?;
  let client = Client::builder()
    .timeout(Duration::from_secs(4))
    .build()
    .map_err(|e| e.to_string())?;
  let response = client.get(url).send().await.map_err(|e| format!("Local AI is unavailable: {e}"))?;
  if !response.status().is_success() {
    return Err(format!("Local AI model discovery returned {}", response.status()));
  }

  let mut models = if provider == "ollama" {
    response
      .json::<OllamaTagsResponse>()
      .await
      .map_err(|_| "Ollama returned an invalid model list")?
      .models
      .into_iter()
      .map(|model| LocalAiModel { id: model.name })
      .collect::<Vec<_>>()
  } else {
    response
      .json::<OpenAiModelsResponse>()
      .await
      .map_err(|_| "Local AI returned an invalid OpenAI-compatible model list")?
      .data
      .into_iter()
      .map(|model| LocalAiModel { id: model.id })
      .collect::<Vec<_>>()
  };

  models.sort_by(|a, b| a.id.cmp(&b.id));
  models.dedup_by(|a, b| a.id == b.id);
  Ok(models)
}

#[tauri::command]
pub async fn local_ai_analyze_text(
  provider: String,
  endpoint: Option<String>,
  model: String,
  text: String,
  task: Option<String>,
  consent: bool,
) -> Result<LocalAiAnalysis, String> {
  if !consent {
    return Err("Explicit local AI analysis consent is required".to_string());
  }
  let model = model.trim().to_string();
  if model.is_empty() {
    return Err("Select a local model first".to_string());
  }
  if text.trim().is_empty() {
    return Err("No local text was provided for analysis".to_string());
  }

  let base = normalize_base_endpoint(&provider, endpoint.as_deref())?;
  let url = chat_url(&provider, &base)?;
  let input_truncated = text.chars().count() > MAX_INPUT_CHARS;
  let input = trim_chars(&text, MAX_INPUT_CHARS);
  let task = trim_chars(task.as_deref().unwrap_or("Review for business, cost, operational and security anomalies."), MAX_TASK_CHARS);
  let user_prompt = format!("Audit task: {task}\n\nLocal source text:\n{input}");

  let client = Client::builder()
    .timeout(Duration::from_secs(90))
    .build()
    .map_err(|e| e.to_string())?;

  let payload = if provider == "ollama" {
    json!({
      "model": model,
      "stream": false,
      "format": "json",
      "messages": [
        {"role": "system", "content": system_prompt()},
        {"role": "user", "content": user_prompt}
      ],
      "options": {"temperature": 0.1}
    })
  } else {
    json!({
      "model": model,
      "temperature": 0.1,
      "response_format": {"type": "json_object"},
      "messages": [
        {"role": "system", "content": system_prompt()},
        {"role": "user", "content": user_prompt}
      ]
    })
  };

  let response = client
    .post(url)
    .json(&payload)
    .send()
    .await
    .map_err(|e| format!("Local AI request failed: {e}"))?;

  if !response.status().is_success() {
    return Err(format!("Local AI analysis returned {}", response.status()));
  }

  let content = if provider == "ollama" {
    response
      .json::<OllamaChatResponse>()
      .await
      .map_err(|_| "Ollama returned an invalid chat response")?
      .message
      .content
  } else {
    response
      .json::<OpenAiChatResponse>()
      .await
      .map_err(|_| "Local AI returned an invalid OpenAI-compatible chat response")?
      .choices
      .into_iter()
      .next()
      .map(|choice| choice.message.content)
      .ok_or("Local AI returned no completion")?
  };

  let findings = parse_findings(&content)?;
  Ok(LocalAiAnalysis {
    provider,
    model,
    input_truncated,
    findings,
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn remote_local_ai_endpoints_fail_closed() {
    assert!(normalize_base_endpoint("custom-local", Some("https://api.openai.com")).is_err());
    assert!(normalize_base_endpoint("jev", Some("http://192.168.1.5:8000")).is_err());
    assert!(normalize_base_endpoint("jev", Some("http://127.0.0.1:8000")).is_ok());
  }

  #[test]
  fn provider_paths_remain_loopback_only() {
    let ollama = normalize_base_endpoint("ollama", None).unwrap();
    assert_eq!(chat_url("ollama", &ollama).unwrap().as_str(), "http://127.0.0.1:11434/api/chat");
    let lm = normalize_base_endpoint("lm-studio", None).unwrap();
    assert_eq!(models_url("lm-studio", &lm).unwrap().as_str(), "http://127.0.0.1:1234/v1/models");
  }

  #[test]
  fn model_findings_are_bounded_and_secret_evidence_is_redacted() {
    let raw = r#"{"findings":[{"category":"security","severity":"critical","confidence":140,"title":"Credential issue","summary":"Review this","evidence":"password: abcdefghijklmnopqrstuvwxyzABCDEFG123456","remediation":"Rotate manually"}]}"#;
    let findings = parse_findings(raw).unwrap();
    assert_eq!(findings.len(), 1);
    assert_eq!(findings[0].confidence, 100);
    assert_eq!(findings[0].evidence, "Potential sensitive credential content detected; evidence redacted by CashPatch.");
  }

  #[test]
  fn long_token_like_output_is_redacted() {
    let text = redact_token_like_words("token abcdefghijklmnopqrstuvwxyzABCDEFG123456 end");
    assert_eq!(text, "token [REDACTED] end");
  }
}
