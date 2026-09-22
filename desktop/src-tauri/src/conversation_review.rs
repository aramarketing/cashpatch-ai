use crate::conversations::load_user_selected_export;
#[path = "local_ai.rs"]
mod local_ai;
use serde::Serialize;
use std::path::Path;
use uuid::Uuid;

const MAX_FINDINGS: usize = 120;
const EVIDENCE_CHARS: usize = 260;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationReviewFinding {
  pub id: String,
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
pub struct ConversationReview {
  pub source_format: String,
  pub messages_reviewed: usize,
  pub characters_reviewed: usize,
  pub truncated: bool,
  pub findings: Vec<ConversationReviewFinding>,
}

fn contains_any(haystack: &str, needles: &[&str]) -> bool {
  needles.iter().any(|needle| haystack.contains(needle))
}

fn safe_snippet(text: &str) -> String {
  let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
  let mut snippet = normalized.chars().take(EVIDENCE_CHARS + 1).collect::<String>();
  if snippet.chars().count() > EVIDENCE_CHARS {
    snippet = snippet.chars().take(EVIDENCE_CHARS).collect::<String>();
    snippet.push('…');
  }
  snippet
}

fn add_finding(
  findings: &mut Vec<ConversationReviewFinding>,
  category: &str,
  severity: &str,
  confidence: u8,
  title: &str,
  summary: &str,
  evidence: String,
  remediation: &str,
) {
  if findings.len() >= MAX_FINDINGS {
    return;
  }

  findings.push(ConversationReviewFinding {
    id: Uuid::new_v4().to_string(),
    category: category.to_string(),
    severity: severity.to_string(),
    confidence,
    title: title.to_string(),
    summary: summary.to_string(),
    evidence,
    remediation: remediation.to_string(),
  });
}

pub fn analyze_user_selected_export(path: &Path) -> Result<ConversationReview, String> {
  let imported = load_user_selected_export(path)?;
  let mut findings = Vec::<ConversationReviewFinding>::new();

  for (index, message) in imported.messages.iter().enumerate() {
    if findings.len() >= MAX_FINDINGS {
      break;
    }

    let lower = message.text.to_lowercase();
    let message_number = index + 1;
    let role = if message.role.trim().is_empty() { "unknown" } else { message.role.as_str() };

    if contains_any(&lower, &[
      "doppelte rechnung", "doppelt berechnet", "zweimal berechnet", "double invoice",
      "charged twice", "duplicate invoice", "overpaid", "zu viel bezahlt", "überbezahlt",
    ]) {
      add_finding(
        &mut findings,
        "cost_efficiency",
        "high",
        92,
        "Possible duplicate charge or overpayment",
        "A conversation explicitly mentions a possible duplicate invoice, duplicate charge or overpayment.",
        format!("Message {message_number} ({role}): {}", safe_snippet(&message.text)),
        "Verify the invoice, payment reference and bank transaction manually before requesting a correction or refund.",
      );
    }

    if contains_any(&lower, &[
      "subscription", "abo ", "abonnement", "monthly plan", "yearly plan", "per month",
      "monatlich", "jährlich", "annual plan", "renewal", "verlängerung",
    ]) {
      add_finding(
        &mut findings,
        "recurring_cost",
        "medium",
        72,
        "Recurring cost mentioned",
        "A recurring subscription or renewal appears in the conversation and may deserve a cost/necessity review.",
        format!("Message {message_number} ({role}): {}", safe_snippet(&message.text)),
        "Compare the recurring cost with actual usage and contract terms; cancel or downgrade manually if it is no longer justified.",
      );
    }

    if contains_any(&lower, &[
      "todo", "to-do", "follow up", "follow-up", "remind me", "erinnere mich", "muss noch",
      "noch erledigen", "nachfassen", "offene aufgabe", "pending task", "action item",
    ]) {
      add_finding(
        &mut findings,
        "open_task",
        "medium",
        78,
        "Possible unresolved task",
        "The conversation contains language that looks like an open action item or follow-up.",
        format!("Message {message_number} ({role}): {}", safe_snippet(&message.text)),
        "Confirm whether this action is still open, assign an owner and due date, and close it manually when completed.",
      );
    }

    if contains_any(&lower, &[
      "deadline", "frist", "fällig", "faellig", "due date", "due on", "bis zum", "expires on",
      "läuft ab", "laeuft ab", "renew by",
    ]) {
      add_finding(
        &mut findings,
        "deadline",
        "high",
        82,
        "Deadline or expiry mentioned",
        "A deadline, due date, expiry or renewal date appears in the conversation.",
        format!("Message {message_number} ({role}): {}", safe_snippet(&message.text)),
        "Verify the date against the source document or system and create a human-owned reminder if action is still required.",
      );
    }

    if contains_any(&lower, &[
      "funktioniert nicht", "not working", "fehler", " error ", "failed", "failure", "crash",
      "absturz", "broken", "bug", "problem persists", "geht nicht",
    ]) {
      add_finding(
        &mut findings,
        "operational_risk",
        "medium",
        74,
        "Unresolved error or failure mentioned",
        "The conversation contains language indicating a technical or operational failure that may still need follow-up.",
        format!("Message {message_number} ({role}): {}", safe_snippet(&message.text)),
        "Check the current system state and close the issue only after the underlying failure is verified as resolved.",
      );
    }

    let credential_language = contains_any(&lower, &[
      "password", "passwort", "api key", "api-key", "secret key", "access token", "refresh token",
      "private key", "kennwort",
    ]);
    let sharing_language = contains_any(&lower, &[
      "here is", "is:", "lautet", "verwende", "use this", "token:", "password:", "passwort:",
    ]);
    if credential_language && sharing_language {
      add_finding(
        &mut findings,
        "credential_exposure",
        "critical",
        88,
        "Possible credential shared in an AI conversation",
        "A message combines credential-related language with wording that may indicate the secret itself was pasted into the conversation. The potential secret is intentionally not reproduced in the finding evidence.",
        format!("Message {message_number} ({role}) contains potential credential-sharing language; content redacted by CashPatch."),
        "Rotate the affected credential manually, remove it from future prompts, and store replacement credentials only in an approved password manager or the local CashPatch vault.",
      );
    }

    if contains_any(&lower, &[
      "i think", "i assume", "probably", "maybe", "vermutlich", "wahrscheinlich", "ich glaube",
      "nicht sicher", "unsicher", "not sure", "could be",
    ]) && contains_any(&lower, &["invoice", "rechnung", "contract", "vertrag", "payment", "zahlung", "tax", "steuer"]) {
      add_finding(
        &mut findings,
        "uncertain_business_fact",
        "medium",
        68,
        "Uncertain financial or contractual assumption",
        "A financial, contractual or tax-related statement is explicitly framed as uncertain and should not be treated as verified fact.",
        format!("Message {message_number} ({role}): {}", safe_snippet(&message.text)),
        "Verify the claim against the original invoice, contract, account record or qualified professional before acting on it.",
      );
    }
  }

  Ok(ConversationReview {
    source_format: imported.source_format,
    messages_reviewed: imported.messages.len(),
    characters_reviewed: imported.characters,
    truncated: imported.truncated || findings.len() >= MAX_FINDINGS,
    findings,
  })
}

async fn enrich_with_available_local_ai(path: &Path, review: &mut ConversationReview) {
  if review.findings.len() >= MAX_FINDINGS {
    return;
  }

  let imported = match load_user_selected_export(path) {
    Ok(imported) => imported,
    Err(_) => return,
  };

  let mut text = String::new();
  for message in imported.messages.iter().take(400) {
    let role = if message.role.trim().is_empty() { "unknown" } else { message.role.as_str() };
    text.push_str(role);
    text.push_str(": ");
    text.push_str(&message.text);
    text.push('\n');
    if text.chars().count() >= 12_000 {
      break;
    }
  }

  if text.trim().is_empty() {
    return;
  }

  for provider in ["ollama", "lm-studio"] {
    let models = match local_ai::local_ai_models(provider.to_string(), None).await {
      Ok(models) if !models.is_empty() => models,
      _ => continue,
    };
    let model = models[0].id.clone();
    let analysis = match local_ai::local_ai_analyze_text(
      provider.to_string(),
      None,
      model,
      text.clone(),
      Some("Review this user-approved AI conversation export for contradictions, unresolved tasks, financial or contractual risk, security concerns, duplicated work, likely cost waste, and statements that require human verification.".to_string()),
      true,
    )
    .await
    {
      Ok(analysis) => analysis,
      Err(_) => continue,
    };

    for finding in analysis.findings {
      if review.findings.len() >= MAX_FINDINGS {
        review.truncated = true;
        break;
      }
      review.findings.push(ConversationReviewFinding {
        id: Uuid::new_v4().to_string(),
        category: finding.category,
        severity: finding.severity,
        confidence: finding.confidence,
        title: format!("Local AI: {}", finding.title),
        summary: finding.summary,
        evidence: finding.evidence,
        remediation: finding.remediation,
      });
    }
    review.truncated = review.truncated || analysis.input_truncated;
    break;
  }
}

#[tauri::command]
pub async fn conversation_review_import(path: String, consent: bool) -> Result<ConversationReview, String> {
  if !consent {
    return Err("Explicit consent is required before reviewing an AI conversation export".to_string());
  }

  let path = Path::new(path.trim());
  if path.as_os_str().is_empty() {
    return Err("Select a local conversation export first".to_string());
  }

  let mut review = analyze_user_selected_export(path)?;
  enrich_with_available_local_ai(path, &mut review).await;
  Ok(review)
}
