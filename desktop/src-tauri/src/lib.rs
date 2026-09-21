use keyring::Entry;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, path::PathBuf};
use tauri::{
  menu::{Menu, MenuItem},
  tray::TrayIconBuilder,
  Manager, WindowEvent,
};
use uuid::Uuid;

const CLOUD_BASE: &str = "https://cashpatch-ai.vercel.app";
const KEYRING_SERVICE: &str = "com.cashpatch.desktop";

fn ad_hoc_test_store_enabled() -> bool {
  #[cfg(target_os = "macos")]
  {
    option_env!("CASHPATCH_ADHOC_TEST_BUILD") == Some("1")
  }
  #[cfg(not(target_os = "macos"))]
  {
    false
  }
}

fn keyring_entry(name: &str) -> Result<Entry, String> {
  Entry::new(KEYRING_SERVICE, name).map_err(|e| e.to_string())
}

fn test_store_path() -> Result<PathBuf, String> {
  let home = std::env::var_os("HOME").ok_or("HOME is not available")?;
  let dir = PathBuf::from(home)
    .join("Library")
    .join("Application Support")
    .join("CashPatch");

  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
  }

  Ok(dir.join("device-session.json"))
}

fn test_store_load() -> Result<BTreeMap<String, String>, String> {
  let path = test_store_path()?;
  if !path.exists() {
    return Ok(BTreeMap::new());
  }

  let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
  if raw.trim().is_empty() {
    return Ok(BTreeMap::new());
  }

  serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn test_store_save(values: &BTreeMap<String, String>) -> Result<(), String> {
  let path = test_store_path()?;
  let temp = path.with_extension("tmp");
  let body = serde_json::to_vec(values).map_err(|e| e.to_string())?;

  fs::write(&temp, body).map_err(|e| e.to_string())?;

  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&temp, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
  }

  fs::rename(&temp, &path).map_err(|e| e.to_string())?;

  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
  }

  Ok(())
}

fn secret_get(name: &str) -> Option<String> {
  if ad_hoc_test_store_enabled() {
    return test_store_load().ok()?.get(name).cloned();
  }
  keyring_entry(name).ok()?.get_password().ok()
}

fn secret_set(name: &str, value: &str) -> Result<(), String> {
  if ad_hoc_test_store_enabled() {
    let mut values = test_store_load()?;
    values.insert(name.to_string(), value.to_string());
    return test_store_save(&values);
  }
  keyring_entry(name)?.set_password(value).map_err(|e| e.to_string())
}

fn secret_delete(name: &str) {
  if ad_hoc_test_store_enabled() {
    if let Ok(mut values) = test_store_load() {
      values.remove(name);
      let _ = test_store_save(&values);
    }
    return;
  }

  if let Ok(entry) = keyring_entry(name) {
    let _ = entry.delete_password();
  }
}

fn get_or_create_device_public_id() -> Result<String, String> {
  if let Some(existing) = secret_get("device-public-id") {
    return Ok(existing);
  }
  let id = Uuid::new_v4().to_string();
  secret_set("device-public-id", &id)?;
  Ok(id)
}

fn platform_name() -> &'static str {
  #[cfg(target_os = "macos")]
  { "macos" }
  #[cfg(target_os = "windows")]
  { "windows" }
  #[cfg(not(any(target_os = "macos", target_os = "windows")))]
  { "unsupported" }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PairStartRequest {
  device_public_id: String,
  device_name: String,
  platform: String,
  architecture: String,
  app_version: String,
  public_key: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PairStartResponse {
  pairing_code: String,
  pairing_secret: String,
  approve_url: String,
  expires_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PairStartPublic {
  pairing_code: String,
  approve_url: String,
  expires_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairConsumeResponse {
  state: String,
  device_id: Option<String>,
  device_credential: Option<String>,
}

#[derive(Serialize)]
struct PairConsumePublic {
  state: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct EntitlementResponse {
  allowed: bool,
  billing_status: Option<String>,
  plan: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EntitlementPublic {
  paired: bool,
  allowed: bool,
  billing_status: Option<String>,
  plan: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalAiRuntime {
  key: String,
  name: String,
  endpoint: String,
  available: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DetectedSource {
  key: String,
  name: String,
  kind: String,
  installed: bool,
  permission_hint: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CloudSource {
  id: String,
  provider: String,
  category: String,
  display_name: Option<String>,
  status: String,
  scopes: Vec<String>,
  capabilities: Vec<String>,
  permission_mode: String,
  external_write_allowed: bool,
  updated_at: Option<String>,
}

#[derive(Deserialize)]
struct CloudSourcesResponse {
  sources: Vec<CloudSource>,
}

fn path_exists(path: &str) -> bool {
  std::path::Path::new(path).exists()
}

#[tauri::command]
async fn discover_local_ai() -> Result<Vec<LocalAiRuntime>, String> {
  let client = reqwest::Client::builder()
    .timeout(std::time::Duration::from_millis(700))
    .build()
    .map_err(|e| e.to_string())?;

  let mut runtimes = Vec::new();

  let ollama = client
    .get("http://127.0.0.1:11434/api/tags")
    .send()
    .await
    .map(|r| r.status().is_success())
    .unwrap_or(false);

  runtimes.push(LocalAiRuntime {
    key: "ollama".to_string(),
    name: "Ollama".to_string(),
    endpoint: "http://127.0.0.1:11434".to_string(),
    available: ollama,
  });

  let lm_studio = client
    .get("http://127.0.0.1:1234/v1/models")
    .send()
    .await
    .map(|r| r.status().is_success())
    .unwrap_or(false);

  runtimes.push(LocalAiRuntime {
    key: "lm-studio".to_string(),
    name: "LM Studio".to_string(),
    endpoint: "http://127.0.0.1:1234".to_string(),
    available: lm_studio,
  });

  Ok(runtimes)
}

#[tauri::command]
fn discover_supported_apps() -> Result<Vec<DetectedSource>, String> {
  let mut sources = Vec::new();

  #[cfg(target_os = "macos")]
  {
    let candidates = [
      ("chrome", "Google Chrome", "browser", "/Applications/Google Chrome.app", "Browser observer can be installed with explicit site permissions."),
      ("outlook", "Microsoft Outlook", "email", "/Applications/Microsoft Outlook.app", "Connect Microsoft 365 with read-only mail permissions."),
      ("slack", "Slack", "communication", "/Applications/Slack.app", "Connect approved Slack workspaces with read-only scopes."),
      ("teams", "Microsoft Teams", "communication", "/Applications/Microsoft Teams.app", "Connect Microsoft Teams with read-only permissions."),
      ("notion", "Notion", "project_management", "/Applications/Notion.app", "Connect approved Notion workspaces with read-only permissions."),
    ];

    for (key, name, kind, path, hint) in candidates {
      sources.push(DetectedSource {
        key: key.to_string(),
        name: name.to_string(),
        kind: kind.to_string(),
        installed: path_exists(path),
        permission_hint: hint.to_string(),
      });
    }
  }

  #[cfg(target_os = "windows")]
  {
    let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let program_files = std::env::var("ProgramFiles").unwrap_or_default();
    let program_files_x86 = std::env::var("ProgramFiles(x86)").unwrap_or_default();

    let candidates = vec![
      ("chrome", "Google Chrome", "browser", vec![
        format!(r"{}\Google\Chrome\Application\chrome.exe", program_files),
        format!(r"{}\Google\Chrome\Application\chrome.exe", program_files_x86)
      ], "Browser observer can be installed with explicit site permissions."),
      ("outlook", "Microsoft Outlook", "email", vec![
        format!(r"{}\Microsoft Office\root\Office16\OUTLOOK.EXE", program_files),
        format!(r"{}\Microsoft Office\root\Office16\OUTLOOK.EXE", program_files_x86)
      ], "Connect Microsoft 365 with read-only mail permissions."),
      ("slack", "Slack", "communication", vec![
        format!(r"{}\slack\slack.exe", local)
      ], "Connect approved Slack workspaces with read-only scopes."),
      ("teams", "Microsoft Teams", "communication", vec![
        format!(r"{}\Microsoft\WindowsApps\ms-teams.exe", local)
      ], "Connect Microsoft Teams with read-only permissions."),
      ("notion", "Notion", "project_management", vec![
        format!(r"{}\Programs\Notion\Notion.exe", local)
      ], "Connect approved Notion workspaces with read-only permissions."),
    ];

    for (key, name, kind, paths, hint) in candidates {
      sources.push(DetectedSource {
        key: key.to_string(),
        name: name.to_string(),
        kind: kind.to_string(),
        installed: paths.iter().any(|p| path_exists(p)),
        permission_hint: hint.to_string(),
      });
    }
  }

  Ok(sources)
}

#[tauri::command]
async fn pair_start(app: tauri::AppHandle) -> Result<PairStartPublic, String> {
  let device_id = get_or_create_device_public_id()?;
  let device_name = hostname::get()
    .map(|h| h.to_string_lossy().to_string())
    .unwrap_or_else(|_| "CashPatch computer".to_string());
  let version = app.package_info().version.to_string();

  let request = PairStartRequest {
    device_public_id: device_id,
    device_name,
    platform: platform_name().to_string(),
    architecture: std::env::consts::ARCH.to_string(),
    app_version: version,
    public_key: String::new(),
  };

  let response = reqwest::Client::new()
    .post(format!("{}/api/desktop/pair/start", CLOUD_BASE))
    .json(&request)
    .send()
    .await
    .map_err(|e| e.to_string())?;

  if !response.status().is_success() {
    return Err(format!("Pairing service returned {}", response.status()));
  }

  let result: PairStartResponse = response.json().await.map_err(|e| e.to_string())?;
  secret_set("pairing-code", &result.pairing_code)?;
  secret_set("pairing-secret", &result.pairing_secret)?;

  Ok(PairStartPublic {
    pairing_code: result.pairing_code,
    approve_url: result.approve_url,
    expires_at: result.expires_at,
  })
}

#[tauri::command]
async fn pair_consume() -> Result<PairConsumePublic, String> {
  let code = secret_get("pairing-code").ok_or("No active pairing request")?;
  let secret = secret_get("pairing-secret").ok_or("No active pairing secret")?;

  let response = reqwest::Client::new()
    .post(format!("{}/api/desktop/pair/consume", CLOUD_BASE))
    .json(&serde_json::json!({
      "pairingCode": code,
      "pairingSecret": secret
    }))
    .send()
    .await
    .map_err(|e| e.to_string())?;

  if response.status() == StatusCode::CONFLICT {
    return Ok(PairConsumePublic { state: "pending".to_string() });
  }
  if !response.status().is_success() {
    return Err(format!("Pairing service returned {}", response.status()));
  }

  let result: PairConsumeResponse = response.json().await.map_err(|e| e.to_string())?;
  if result.state == "paired" {
    if let (Some(device_id), Some(credential)) = (result.device_id, result.device_credential) {
      secret_set("cloud-device-id", &device_id)?;
      secret_set("device-credential", &credential)?;
      secret_delete("pairing-code");
      secret_delete("pairing-secret");
    }
  }

  Ok(PairConsumePublic { state: result.state })
}

#[tauri::command]
async fn entitlement_check(app: tauri::AppHandle) -> Result<EntitlementPublic, String> {
  let Some(device_id) = secret_get("cloud-device-id") else {
    return Ok(EntitlementPublic {
      paired: false,
      allowed: false,
      billing_status: None,
      plan: None,
    });
  };
  let Some(credential) = secret_get("device-credential") else {
    return Ok(EntitlementPublic {
      paired: false,
      allowed: false,
      billing_status: None,
      plan: None,
    });
  };

  let response = reqwest::Client::new()
    .post(format!("{}/api/desktop/entitlement", CLOUD_BASE))
    .json(&serde_json::json!({
      "deviceId": device_id,
      "deviceCredential": credential,
      "appVersion": app.package_info().version.to_string()
    }))
    .send()
    .await
    .map_err(|e| e.to_string())?;

  if response.status() == StatusCode::UNAUTHORIZED {
    return Ok(EntitlementPublic {
      paired: false,
      allowed: false,
      billing_status: None,
      plan: None,
    });
  }
  if !response.status().is_success() {
    return Err(format!("Entitlement service returned {}", response.status()));
  }

  let result: EntitlementResponse = response.json().await.map_err(|e| e.to_string())?;
  Ok(EntitlementPublic {
    paired: true,
    allowed: result.allowed,
    billing_status: result.billing_status,
    plan: result.plan,
  })
}



#[tauri::command]
async fn cloud_sources(app: tauri::AppHandle) -> Result<Vec<CloudSource>, String> {
  let device_id = secret_get("cloud-device-id").ok_or("Device is not paired")?;
  let credential = secret_get("device-credential").ok_or("Device credential is missing")?;

  let response = reqwest::Client::new()
    .post(format!("{}/api/desktop/sources", CLOUD_BASE))
    .json(&serde_json::json!({
      "deviceId": device_id,
      "deviceCredential": credential,
      "appVersion": app.package_info().version.to_string()
    }))
    .send()
    .await
    .map_err(|e| e.to_string())?;

  if !response.status().is_success() {
    return Err(format!("Source service returned {}", response.status()));
  }

  let result: CloudSourcesResponse = response.json().await.map_err(|e| e.to_string())?;
  Ok(result.sources)
}

#[tauri::command]
async fn banking_sync(app: tauri::AppHandle, source_connection_id: String) -> Result<serde_json::Value, String> {
  let device_id = secret_get("cloud-device-id").ok_or("Device is not paired")?;
  let credential = secret_get("device-credential").ok_or("Device credential is missing")?;

  let response = reqwest::Client::new()
    .post(format!("{}/api/desktop/banking/sync", CLOUD_BASE))
    .json(&serde_json::json!({
      "deviceId": device_id,
      "deviceCredential": credential,
      "appVersion": app.package_info().version.to_string(),
      "sourceConnectionId": source_connection_id
    }))
    .send()
    .await
    .map_err(|e| e.to_string())?;

  if !response.status().is_success() {
    return Err(format!("Bank sync returned {}", response.status()));
  }

  response.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

#[tauri::command]
fn approved_folder_get() -> Option<String> {
  secret_get("approved-folder")
}

#[tauri::command]
fn approved_folder_set(path: String) -> Result<(), String> {
  let trimmed = path.trim();
  if trimmed.is_empty() {
    return Err("Folder path cannot be empty".to_string());
  }
  secret_set("approved-folder", trimmed)
}

#[tauri::command]
fn approved_folder_clear() {
  secret_delete("approved-folder");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .setup(|app| {
      #[cfg(desktop)]
      app.handle().plugin(tauri_plugin_autostart::init(
        tauri_plugin_autostart::MacosLauncher::LaunchAgent,
        None,
      ))?;

      let open = MenuItem::with_id(app, "open", "Open CashPatch", true, None::<&str>)?;
      let quit = MenuItem::with_id(app, "quit", "Quit CashPatch", true, None::<&str>)?;
      let menu = Menu::with_items(app, &[&open, &quit])?;

      let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("CashPatch — review-only watchdog");

      if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
      }

      tray
        .on_menu_event(|app, event| match event.id.as_ref() {
          "open" => {
            if let Some(window) = app.get_webview_window("main") {
              let _ = window.show();
              let _ = window.set_focus();
            }
          }
          "quit" => app.exit(0),
          _ => {}
        })
        .build(app)?;

      Ok(())
    })
    .on_window_event(|window, event| {
      if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
      }
    })
    .invoke_handler(tauri::generate_handler![
      pair_start,
      pair_consume,
      entitlement_check,
      discover_local_ai,
      discover_supported_apps,
      cloud_sources,
      banking_sync,
      approved_folder_get,
      approved_folder_set,
      approved_folder_clear
    ])
    .run(tauri::generate_context!())
    .expect("error while running CashPatch");
}
