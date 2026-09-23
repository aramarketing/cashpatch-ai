use serde::Serialize;
use serde_json::Value;
use std::{fs, path::Path};

const MAX_EXPORT_BYTES: u64 = 256 * 1024 * 1024;
const MAX_MESSAGES: usize = 50_000;
const MAX_MESSAGE_CHARS: usize = 24_000;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessage {
  pub role: String,
  pub text: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationImport {
  pub source_format: String,
  pub messages: Vec<ConversationMessage>,
  pub characters: usize,
  pub truncated: bool,
}

fn bounded_text(value: &str) -> (String, bool) {
  let mut truncated = false;
  let text = value
    .chars()
    .take(MAX_MESSAGE_CHARS + 1)
    .collect::<String>();
  let result = if text.chars().count() > MAX_MESSAGE_CHARS {
    truncated = true;
    text.chars().take(MAX_MESSAGE_CHARS).collect::<String>()
  } else {
    text
  };
  (result, truncated)
}

fn text_from_parts(content: &Value) -> Option<String> {
  if let Some(text) = content.as_str() {
    return Some(text.to_string());
  }

  if let Some(parts) = content.get("parts").and_then(Value::as_array) {
    let joined = parts
      .iter()
      .filter_map(Value::as_str)
      .collect::<Vec<_>>()
      .join("\n");
    if !joined.trim().is_empty() {
      return Some(joined);
    }
  }

  content
    .get("text")
    .and_then(Value::as_str)
    .map(ToString::to_string)
}

fn push_message(
  messages: &mut Vec<ConversationMessage>,
  role: Option<&str>,
  text: Option<String>,
  truncated: &mut bool,
) {
  if messages.len() >= MAX_MESSAGES {
    *truncated = true;
    return;
  }

  let Some(text) = text else {
    return;
  };
  let trimmed = text.trim();
  if trimmed.is_empty() {
    return;
  }

  let (text, clipped) = bounded_text(trimmed);
  if clipped {
    *truncated = true;
  }

  messages.push(ConversationMessage {
    role: role.unwrap_or("unknown").trim().to_ascii_lowercase(),
    text,
  });
}

fn parse_chatgpt(root: &Value) -> Option<ConversationImport> {
  let conversations = root.as_array()?;
  if !conversations.iter().any(|item| item.get("mapping").is_some()) {
    return None;
  }

  let mut messages = Vec::<ConversationMessage>::new();
  let mut truncated = false;

  for conversation in conversations {
    let Some(mapping) = conversation.get("mapping").and_then(Value::as_object) else {
      continue;
    };

    for node in mapping.values() {
      let Some(message) = node.get("message") else {
        continue;
      };
      let role = message
        .get("author")
        .and_then(|author| author.get("role"))
        .and_then(Value::as_str);
      let text = message.get("content").and_then(text_from_parts);
      push_message(&mut messages, role, text, &mut truncated);
      if messages.len() >= MAX_MESSAGES {
        truncated = true;
        break;
      }
    }

    if messages.len() >= MAX_MESSAGES {
      break;
    }
  }

  let characters = messages.iter().map(|message| message.text.chars().count()).sum();
  Some(ConversationImport {
    source_format: "chatgpt-export".to_string(),
    messages,
    characters,
    truncated,
  })
}

fn parse_claude(root: &Value) -> Option<ConversationImport> {
  let conversations = root.as_array()?;
  if !conversations
    .iter()
    .any(|item| item.get("chat_messages").and_then(Value::as_array).is_some())
  {
    return None;
  }

  let mut messages = Vec::<ConversationMessage>::new();
  let mut truncated = false;

  for conversation in conversations {
    let Some(chat_messages) = conversation.get("chat_messages").and_then(Value::as_array) else {
      continue;
    };

    for message in chat_messages {
      let role = message
        .get("sender")
        .or_else(|| message.get("role"))
        .and_then(Value::as_str);
      let text = message
        .get("text")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .or_else(|| message.get("content").and_then(text_from_parts));
      push_message(&mut messages, role, text, &mut truncated);
      if messages.len() >= MAX_MESSAGES {
        truncated = true;
        break;
      }
    }

    if messages.len() >= MAX_MESSAGES {
      break;
    }
  }

  let characters = messages.iter().map(|message| message.text.chars().count()).sum();
  Some(ConversationImport {
    source_format: "claude-export".to_string(),
    messages,
    characters,
    truncated,
  })
}

fn gemini_activity_hint(item: &Value) -> bool {
  let contains_hint = |value: &str| {
    let value = value.to_ascii_lowercase();
    value.contains("gemini") || value.contains("bard")
  };

  for key in ["header", "product", "service", "app", "source"] {
    if item.get(key).and_then(Value::as_str).is_some_and(contains_hint) {
      return true;
    }
  }

  item
    .get("products")
    .and_then(Value::as_array)
    .map(|products| products.iter().filter_map(Value::as_str).any(contains_hint))
    .unwrap_or(false)
}

fn parse_gemini_activity(root: &Value) -> Option<ConversationImport> {
  let activities = root.as_array()?;
  if !activities.iter().any(gemini_activity_hint) {
    return None;
  }

  let mut messages = Vec::<ConversationMessage>::new();
  let mut truncated = false;

  for activity in activities.iter().filter(|item| gemini_activity_hint(item)) {
    let title = activity
      .get("title")
      .and_then(Value::as_str)
      .map(ToString::to_string);
    push_message(&mut messages, Some("user"), title, &mut truncated);

    let description = activity
      .get("description")
      .and_then(Value::as_str)
      .map(ToString::to_string);
    push_message(&mut messages, Some("assistant"), description, &mut truncated);

    if let Some(details) = activity.get("details").and_then(Value::as_array) {
      for detail in details {
        let name = detail.get("name").and_then(Value::as_str).unwrap_or("activity");
        let value = detail
          .get("value")
          .or_else(|| detail.get("text"))
          .and_then(Value::as_str)
          .map(ToString::to_string);
        push_message(&mut messages, Some(name), value, &mut truncated);
        if messages.len() >= MAX_MESSAGES {
          break;
        }
      }
    }

    if let Some(turns) = activity
      .get("messages")
      .or_else(|| activity.get("turns"))
      .and_then(Value::as_array)
    {
      for turn in turns {
        let role = turn
          .get("role")
          .or_else(|| turn.get("author"))
          .or_else(|| turn.get("sender"))
          .and_then(Value::as_str);
        let text = turn
          .get("text")
          .and_then(Value::as_str)
          .map(ToString::to_string)
          .or_else(|| turn.get("content").and_then(text_from_parts));
        push_message(&mut messages, role, text, &mut truncated);
        if messages.len() >= MAX_MESSAGES {
          break;
        }
      }
    }

    if messages.len() >= MAX_MESSAGES {
      truncated = true;
      break;
    }
  }

  let characters = messages.iter().map(|message| message.text.chars().count()).sum();
  Some(ConversationImport {
    source_format: "gemini-activity-export".to_string(),
    messages,
    characters,
    truncated,
  })
}

fn parse_generic(value: &Value) -> ConversationImport {
  fn walk(value: &Value, messages: &mut Vec<ConversationMessage>, truncated: &mut bool) {
    if messages.len() >= MAX_MESSAGES {
      *truncated = true;
      return;
    }

    match value {
      Value::Array(items) => {
        for item in items {
          walk(item, messages, truncated);
          if messages.len() >= MAX_MESSAGES {
            break;
          }
        }
      }
      Value::Object(map) => {
        let role = map
          .get("role")
          .or_else(|| map.get("sender"))
          .and_then(Value::as_str);
        let text = map
          .get("text")
          .and_then(Value::as_str)
          .map(ToString::to_string)
          .or_else(|| map.get("content").and_then(text_from_parts));

        if role.is_some() && text.is_some() {
          push_message(messages, role, text, truncated);
        } else {
          for child in map.values() {
            walk(child, messages, truncated);
            if messages.len() >= MAX_MESSAGES {
              break;
            }
          }
        }
      }
      _ => {}
    }
  }

  let mut messages = Vec::<ConversationMessage>::new();
  let mut truncated = false;
  walk(value, &mut messages, &mut truncated);
  let characters = messages.iter().map(|message| message.text.chars().count()).sum();

  ConversationImport {
    source_format: "generic-json-export".to_string(),
    messages,
    characters,
    truncated,
  }
}

fn filename_looks_like_gemini(path: &Path) -> bool {
  let name = path
    .file_name()
    .and_then(|value| value.to_str())
    .unwrap_or_default()
    .to_ascii_lowercase();
  name.contains("gemini") || name.contains("bard")
}

pub fn load_user_selected_export(path: &Path) -> Result<ConversationImport, String> {
  let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
  if !metadata.is_file() {
    return Err("Conversation export must be a local file".to_string());
  }
  if metadata.len() > MAX_EXPORT_BYTES {
    return Err("Conversation export exceeds the local safety size limit".to_string());
  }

  let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
  let value: Value = serde_json::from_str(&raw).map_err(|e| format!("Invalid JSON export: {e}"))?;

  if let Some(parsed) = parse_chatgpt(&value) {
    return Ok(parsed);
  }
  if let Some(parsed) = parse_claude(&value) {
    return Ok(parsed);
  }
  if let Some(parsed) = parse_gemini_activity(&value) {
    return Ok(parsed);
  }

  let mut parsed = parse_generic(&value);
  if filename_looks_like_gemini(path) {
    parsed.source_format = "gemini-json-export".to_string();
  }
  Ok(parsed)
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  #[test]
  fn parses_gemini_activity_without_provider_scraping() {
    let export = json!([
      {
        "header": "Gemini Apps",
        "title": "Asked Gemini to compare two supplier invoices",
        "description": "The invoices may contain a duplicate charge.",
        "products": ["Gemini Apps"],
        "details": [
          {"name": "prompt", "value": "Check whether invoice RE-77 was charged twice"}
        ]
      }
    ]);

    let parsed = parse_gemini_activity(&export).expect("Gemini activity should be recognized");
    assert_eq!(parsed.source_format, "gemini-activity-export");
    assert!(parsed.messages.iter().any(|message| message.text.contains("supplier invoices")));
    assert!(parsed.messages.iter().any(|message| message.text.contains("duplicate charge")));
    assert!(parsed.messages.iter().any(|message| message.text.contains("RE-77")));
  }

  #[test]
  fn ignores_non_gemini_activity_for_gemini_specific_parser() {
    let export = json!([
      {
        "header": "Search",
        "title": "ordinary activity",
        "products": ["Search"]
      }
    ]);

    assert!(parse_gemini_activity(&export).is_none());
  }
}
