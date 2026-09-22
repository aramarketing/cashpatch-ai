use regex::Regex;
use std::{
  fs::File,
  io::Read,
  path::Path,
  sync::OnceLock,
};
use zip::ZipArchive;

const MAX_TEXT_ANALYSIS_BYTES: u64 = 4 * 1024 * 1024;
const MAX_STRUCTURED_INPUT_BYTES: u64 = 32 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_BYTES: usize = 6 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 512;
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
      r"(?i)(?:gesamtbetrag|rechnungsbetrag|zu\s+zahlen|summe|total|amount\s+due)\s*[:=-]?\s*(?:eur|€)?\s*([0-9][0-9., ']*[.,][0-9]{2})\s*(?:eur|€)?",
    )
    .expect("invoice amount regex must compile")
  })
}

fn xml_tag_regex() -> &'static Regex {
  static REGEX: OnceLock<Regex> = OnceLock::new();
  REGEX.get_or_init(|| Regex::new(r"<[^>]+>").expect("XML tag regex must compile"))
}

fn extension(path: &Path) -> String {
  path
    .extension()
    .and_then(|value| value.to_str())
    .unwrap_or_default()
    .to_ascii_lowercase()
}

fn supported_plaintext_extension(path: &Path) -> bool {
  matches!(
    extension(path).as_str(),
    "txt" | "md" | "csv" | "json" | "xml" | "html" | "htm" | "rtf" | "log" | "eml"
  )
}

fn supported_archive_extension(path: &Path) -> bool {
  matches!(extension(path).as_str(), "docx" | "xlsx" | "pptx" | "odt" | "ods")
}

fn normalize_invoice_number(value: &str) -> String {
  value
    .trim_matches(|character: char| !character.is_ascii_alphanumeric() && !matches!(character, '-' | '_' | '/' | '.'))
    .to_ascii_uppercase()
}

fn normalize_amount(value: &str) -> String {
  let compact = value
    .chars()
    .filter(|character| character.is_ascii_digit() || matches!(character, '.' | ','))
    .collect::<String>();

  let last_comma = compact.rfind(',');
  let last_dot = compact.rfind('.');
  let decimal_index = match (last_comma, last_dot) {
    (Some(comma), Some(dot)) => Some(comma.max(dot)),
    (Some(comma), None) => Some(comma),
    (None, Some(dot)) => Some(dot),
    (None, None) => None,
  };

  if let Some(index) = decimal_index {
    let fractional_digits = compact[index + 1..]
      .chars()
      .filter(|character| character.is_ascii_digit())
      .count();
    if fractional_digits == 2 {
      let whole = compact[..index]
        .chars()
        .filter(|character| character.is_ascii_digit())
        .collect::<String>();
      let fraction = compact[index + 1..]
        .chars()
        .filter(|character| character.is_ascii_digit())
        .collect::<String>();
      return format!("{}.{}", if whole.is_empty() { "0" } else { &whole }, fraction);
    }
  }

  compact.chars().filter(|character| character.is_ascii_digit()).collect()
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
    "wiederkehrend",
    "recurring",
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
    .map(|capture| normalize_amount(capture.as_str()))
    .filter(|value| !value.is_empty());

  DocumentSignals {
    invoice: Some(InvoiceSignal {
      invoice_number,
      amount,
      recurring_hint: recurring_hint(text),
    }),
  }
}

fn read_bounded_plaintext(path: &Path, len: u64) -> Result<Option<String>, String> {
  if len == 0 || len > MAX_TEXT_ANALYSIS_BYTES {
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

  Ok(Some(String::from_utf8_lossy(&bytes).into_owned()))
}

fn xml_to_text(xml: &str) -> String {
  let without_tags = xml_tag_regex().replace_all(xml, " ");
  let decoded = without_tags
    .replace("&amp;", "&")
    .replace("&lt;", "<")
    .replace("&gt;", ">")
    .replace("&quot;", "\"")
    .replace("&apos;", "'")
    .replace("&#39;", "'")
    .replace("&#x27;", "'")
    .replace("&nbsp;", " ");

  decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn archive_entry_is_relevant(container_ext: &str, entry_name: &str) -> bool {
  let name = entry_name.to_ascii_lowercase();
  match container_ext {
    "docx" => {
      name == "word/document.xml"
        || name.starts_with("word/header") && name.ends_with(".xml")
        || name.starts_with("word/footer") && name.ends_with(".xml")
    }
    "xlsx" => {
      name == "xl/sharedstrings.xml"
        || name.starts_with("xl/worksheets/") && name.ends_with(".xml")
    }
    "pptx" => name.starts_with("ppt/slides/slide") && name.ends_with(".xml"),
    "odt" | "ods" => name == "content.xml",
    _ => false,
  }
}

fn extract_archive_text(path: &Path, len: u64) -> Result<Option<String>, String> {
  if len == 0 || len > MAX_STRUCTURED_INPUT_BYTES {
    return Ok(None);
  }

  let file = File::open(path).map_err(|error| error.to_string())?;
  let mut archive = ZipArchive::new(file).map_err(|error| format!("Invalid document container: {error}"))?;
  let container_ext = extension(path);
  let mut output = String::new();

  for index in 0..archive.len().min(MAX_ARCHIVE_ENTRIES) {
    if output.len() >= MAX_EXTRACTED_TEXT_BYTES {
      break;
    }

    let mut entry = match archive.by_index(index) {
      Ok(entry) => entry,
      Err(_) => continue,
    };
    if entry.is_dir() || !archive_entry_is_relevant(&container_ext, entry.name()) {
      continue;
    }

    let remaining = MAX_EXTRACTED_TEXT_BYTES.saturating_sub(output.len());
    if remaining == 0 {
      break;
    }

    let mut bytes = Vec::with_capacity((entry.size() as usize).min(remaining));
    entry
      .by_ref()
      .take(remaining as u64)
      .read_to_end(&mut bytes)
      .map_err(|error| error.to_string())?;

    if looks_binary(&bytes) {
      continue;
    }

    let xml = String::from_utf8_lossy(&bytes);
    let text = xml_to_text(&xml);
    if !text.is_empty() {
      if !output.is_empty() {
        output.push('\n');
      }
      output.push_str(&text);
    }
  }

  if output.is_empty() {
    Ok(None)
  } else {
    Ok(Some(output))
  }
}

fn truncate_utf8_bytes(mut value: String, max_bytes: usize) -> String {
  if value.len() <= max_bytes {
    return value;
  }

  let mut boundary = max_bytes;
  while boundary > 0 && !value.is_char_boundary(boundary) {
    boundary -= 1;
  }
  value.truncate(boundary);
  value
}

fn extract_pdf_text(path: &Path, len: u64) -> Result<Option<String>, String> {
  if len == 0 || len > MAX_STRUCTURED_INPUT_BYTES {
    return Ok(None);
  }

  let text = pdf_extract::extract_text(path).map_err(|error| format!("PDF text extraction failed: {error}"))?;
  let text = truncate_utf8_bytes(text, MAX_EXTRACTED_TEXT_BYTES);
  if text.trim().is_empty() {
    Ok(None)
  } else {
    Ok(Some(text))
  }
}

pub fn analyze_document(path: &Path, len: u64) -> Result<Option<DocumentSignals>, String> {
  let text = if supported_plaintext_extension(path) {
    read_bounded_plaintext(path, len)?
  } else if supported_archive_extension(path) {
    extract_archive_text(path, len)?
  } else if extension(path) == "pdf" {
    extract_pdf_text(path, len)?
  } else {
    None
  };

  Ok(text.map(|value| analyze_text(&value)))
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
    assert_eq!(invoice.amount.as_deref(), Some("1234.56"));
    assert!(invoice.recurring_hint);
  }

  #[test]
  fn extracts_english_invoice_number_and_amount() {
    let signals = analyze_text("Invoice # INV-7788\nAmount due: EUR 1,249.90\nAnnual subscription");
    let invoice = signals.invoice.expect("invoice signal expected");
    assert_eq!(invoice.invoice_number, "INV-7788");
    assert_eq!(invoice.amount.as_deref(), Some("1249.90"));
    assert!(invoice.recurring_hint);
  }

  #[test]
  fn equivalent_european_and_english_totals_normalize_identically() {
    assert_eq!(normalize_amount("1.234,56"), "1234.56");
    assert_eq!(normalize_amount("1,234.56"), "1234.56");
    assert_eq!(normalize_amount("1 234,56"), "1234.56");
  }

  #[test]
  fn office_and_open_document_formats_are_recognized_as_local_containers() {
    for name in ["invoice.docx", "costs.xlsx", "deck.pptx", "offer.odt", "ledger.ods"] {
      assert!(supported_archive_extension(Path::new(name)), "{name} should be supported");
    }
  }

  #[test]
  fn xml_text_extraction_preserves_invoice_signals_across_runs() {
    let xml = r#"<w:p><w:r><w:t>Rechnungs-</w:t></w:r><w:r><w:t>Nr.: RE-77</w:t></w:r></w:p><w:p><w:r><w:t>Gesamtbetrag: 99,90 EUR</w:t></w:r></w:p>"#;
    let signals = analyze_text(&xml_to_text(xml));
    let invoice = signals.invoice.expect("invoice signal expected");
    assert_eq!(invoice.invoice_number, "RE-77");
    assert_eq!(invoice.amount.as_deref(), Some("99.90"));
  }

  #[test]
  fn ignores_text_without_an_explicit_invoice_number() {
    let signals = analyze_text("Invoice received. Please review the attached document.");
    assert!(signals.invoice.is_none());
  }
}
