use keyring::Entry;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::Manager;
use uuid::Uuid;

const CLOUD_BASE: &str = "https://cashpatch-ai.vercel.app";
const KEYRING_SERVICE: &str = "com.cashpatch.desktop";

fn keyring_entry(name: &str) -> Result<Entry, String> {
  Entry::new(KEYRING_SERVICE, name).map_err(|e| e.to_string())
}

fn secret_get(name: &str) -> Option<String> {
  keyring_entry(name).ok()?.get_password().ok()
}

fn secret_set(name: &str, value: &str) -> Result<(), String> {
  keyring_entry(name)?.set_password(value).map_err(|e| e.to_string())
}

fn secret_delete(name: &str) {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .setup(|app| {
      #[cfg(desktop)]
      app.handle().plugin(tauri_plugin_autostart::init(
        tauri_plugin_autostart::MacosLauncher::LaunchAgent,
        None,
      ))?;
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      pair_start,
      pair_consume,
      entitlement_check
    ])
    .run(tauri::generate_context!())
    .expect("error while running CashPatch");
}
