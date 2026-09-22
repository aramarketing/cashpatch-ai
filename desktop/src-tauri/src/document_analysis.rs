use regex::Regex;
use std::{fs::File, io::Read, path::Path, sync::OnceLock};

const MAX_TEXT_ANALYSIS_BYTES: u64 = 4 * 1024 * 1024;
const MAX_NUL_RATIO: f64 = 0.01;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InvoiceSignal {
  pub invoice_number: String,
  pub amount: Option<String>,
  pub recurring_hint: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DocumentSignals {
  pub invoice: Option<InvoiceSignal>,
}

fn invoice_number_regex() -> &'static Regex {
  static REGEX: OnceLock<Regex> = OnceLock::new();
  REGEX.get_or_init(|| {
    Regex::new(
      r"(?i)(?:rechnungs[\s-]*(?:nummer|nr\.?)|rechnung[\s-]*(?:nummer|nr\.?)|invoice[\s-]*(?:number|no\.?|#|id))\s*[:#-]?\s*([a-z0-9][a-z0-9._/-]{2,})",
    )
    .expect("invoice number regex must compile")
  })
}

fn amount_regex() -> &'static Regex {
  static REGEX: OnceLock<Regex> = OnceLock::new();
  REGEX.get_or_init(|| {
    Regex::new(
      r"(?i)(?:gesamtbetrag|rechnungsbetrag|zu\s+zahlen|summe|total|amount\s+due)\s*[:=-]?\s*(?:eur|€)?\s*([0-9][0-9.\s']*(?:,[0-9]{2}|\.[0-9]{2}))\s*(?:eur|€)?",
    )
    .expect("invoice amount regex must compile")
  })
}

fn supported_text_extension(path: &Path) -> bool {
  let ext = path
    .extension()
    .and_then(|value| value.to_str())
    .unwrap_or_default()
    .to_ascii_lowercase();

  matches!(
    ext.as_str(),
    "txt" | "md" | "csv" | "json" | "xml" | "html" | "htm" | "rtf" | "log" | "eml"
  )
}

fn normalize_invoice_number(value: &str) -> String {
  value
    .trim_matches(|character: char| !character.is_ascii_alphanumeric() && !matches!(character, '-' | '_' | '/' | '.'))
    .to_ascii_uppercase()
}

fn normalize_amount(value: &str) -> String {
  value.chars().filter(|character| !character.is_whitespace() && *character != '\'').collect()
}

fn looks_binary(bytes: &[u8]) -> bool {
  if bytes.is_empty() {
    return false;
  }

  let sample = &bytes[..bytes.len().min(64 * 1024)];
  let nul_count = sample.iter().filter(|byte| **byte == 0).count();
  (nul_count as f64 / sample.len() as f64) > MAX_NUL_RATIO
}

fn recurring_hint(text: &str) -> bool {
  let lower = text.to_ascii_lowercase();
  [
    "monatlich",
    "monthly",
    "jährlich",
    "jaehrlich",
    "yearly",
    "annual",
    "subscription",
    "abonnement",
    "abo ",
    "renewal",
  ]
  .iter()
  .any(|needle| lower.contains(needle))
}

fn analyze_text(text: &str) -> DocumentSignals {
  let lower = text.to_ascii_lowercase();
  if !lower.contains("rechnung") && !lower.contains("invoice") {
    return DocumentSignals::default();
  }

  let invoice_number = invoice_number_regex()
    .captures(text)
    .and_then(|captures| captures.get(1))
    .map(|capture| normalize_invoice_number(capture.as_str()))
    .filter(|value| value.len() >= 3);

  let Some(invoice_number) = invoice_number else {
    return DocumentSignals::default();
  };

  let amount = amount_regex()
    .captures(text)
    .and_then(|captures| captures.get(1))
    .map(|capture| normalize_amount(capture.as_str()));

  DocumentSignals {
    invoice: Some(InvoiceSignal {
      invoice_number,
      amount,
      recurring_hint: recurring_hint(text),
    }),
  }
}

pub fn analyze_document(path: &Path, len: u64) -> Result<Option<DocumentSignals>, String> {
  if len == 0 || len > MAX_TEXT_ANALYSIS_BYTES || !supported_text_extension(path) {
    return Ok(None);
  }

  let mut file = File::open(path).map_err(|error| error.to_string())?;
  let mut bytes = Vec::with_capacity(len.min(MAX_TEXT_ANALYSIS_BYTES) as usize);
  file
    .take(MAX_TEXT_ANALYSIS_BYTES + 1)
    .read_to_end(&mut bytes)
    .map_err(|error| error.to_string())?;

  if bytes.len() as u64 > MAX_TEXT_ANALYSIS_BYTES || looks_binary(&bytes) {
    return Ok(None);
  }

  let text = String::from_utf8_lossy(&bytes);
  Ok(Some(analyze_text(&text)))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn extracts_german_invoice_number_and_total() {
    let signals = analyze_text(
      "Rechnung\nRechnungs-Nr.: RE-2026-0042\nGesamtbetrag: 1.234,56 EUR\nZahlbar monatlich",
    );

    let invoice = signals.invoice.expect("invoice signal expected");
    assert_eq!(invoice.invoice_number, "RE-2026-0042");
    assert_eq!(invoice.amount.as_deref(), Some("1.234,56"));
    assert!(invoice.recurring_hint);
  }

  #[test]
  fn extracts_english_invoice_number_and_amount() {
    let signals = analyze_text("Invoice # INV-7788\nAmount due: EUR 249.90\nAnnual subscription");
    let invoice = signals.invoice.expect("invoice signal expected");
    assert_eq!(invoice.invoice_number, "INV-7788");
    assert_eq!(invoice.amount.as_deref(), Some("249.90"));
    assert!(invoice.recurring_hint);
  }

  #[test]
  fn ignores_text_without_an_explicit_invoice_number() {
    let signals = analyze_text("Invoice received. Please review the attached document.");
    assert!(signals.invoice.is_none());
  }
}
