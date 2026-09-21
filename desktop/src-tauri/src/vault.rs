use argon2::Argon2;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chacha20poly1305::{
  aead::{Aead, KeyInit},
  XChaCha20Poly1305, XNonce,
};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use std::{
  fs,
  path::PathBuf,
  sync::{Mutex, OnceLock},
  time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use uuid::Uuid;
use zeroize::Zeroizing;

const VAULT_VERSION: u32 = 1;
const VAULT_AAD: &[u8] = b"CashPatchVault:v1";
const AUTO_LOCK_AFTER: Duration = Duration::from_secs(10 * 60);

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VaultEnvelope {
  version: u32,
  salt: String,
  nonce: String,
  ciphertext: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VaultEntry {
  id: String,
  label: String,
  username: String,
  secret: String,
  url: String,
  notes: String,
  created_at_epoch: u64,
  updated_at_epoch: u64,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VaultPayload {
  entries: Vec<VaultEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultEntrySummary {
  id: String,
  label: String,
  username: String,
  url: String,
  notes: String,
  created_at_epoch: u64,
  updated_at_epoch: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
  exists: bool,
  unlocked: bool,
  auto_lock_seconds: u64,
}

struct VaultRuntime {
  key: Option<Zeroizing<Vec<u8>>>,
  last_activity: Option<Instant>,
}

impl Default for VaultRuntime {
  fn default() -> Self {
    Self {
      key: None,
      last_activity: None,
    }
  }
}

static VAULT_RUNTIME: OnceLock<Mutex<VaultRuntime>> = OnceLock::new();

fn runtime() -> &'static Mutex<VaultRuntime> {
  VAULT_RUNTIME.get_or_init(|| Mutex::new(VaultRuntime::default()))
}

fn vault_path(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
  }

  Ok(dir.join("cashpatch.vault"))
}

fn now_epoch() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_secs()
}

fn derive_key(master_password: &str, salt: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
  if master_password.len() < 12 {
    return Err("Master passphrase must be at least 12 characters".to_string());
  }

  let mut key = Zeroizing::new(vec![0_u8; 32]);
  Argon2::default()
    .hash_password_into(master_password.as_bytes(), salt, &mut key)
    .map_err(|_| "Unable to derive vault key".to_string())?;
  Ok(key)
}

fn encrypt_payload(payload: &VaultPayload, key: &[u8], salt: &[u8]) -> Result<VaultEnvelope, String> {
  let cipher = XChaCha20Poly1305::new_from_slice(key).map_err(|_| "Invalid vault key".to_string())?;
  let mut nonce_bytes = [0_u8; 24];
  OsRng.fill_bytes(&mut nonce_bytes);
  let nonce = XNonce::from_slice(&nonce_bytes);

  let plaintext = Zeroizing::new(serde_json::to_vec(payload).map_err(|e| e.to_string())?);
  let ciphertext = cipher
    .encrypt(
      nonce,
      chacha20poly1305::aead::Payload {
        msg: &plaintext,
        aad: VAULT_AAD,
      },
    )
    .map_err(|_| "Unable to encrypt vault".to_string())?;

  Ok(VaultEnvelope {
    version: VAULT_VERSION,
    salt: BASE64.encode(salt),
    nonce: BASE64.encode(nonce_bytes),
    ciphertext: BASE64.encode(ciphertext),
  })
}

fn decrypt_payload(envelope: &VaultEnvelope, key: &[u8]) -> Result<VaultPayload, String> {
  if envelope.version != VAULT_VERSION {
    return Err("Unsupported vault version".to_string());
  }

  let nonce_bytes = BASE64
    .decode(&envelope.nonce)
    .map_err(|_| "Invalid vault nonce".to_string())?;
  if nonce_bytes.len() != 24 {
    return Err("Invalid vault nonce".to_string());
  }
  let ciphertext = BASE64
    .decode(&envelope.ciphertext)
    .map_err(|_| "Invalid vault ciphertext".to_string())?;

  let cipher = XChaCha20Poly1305::new_from_slice(key).map_err(|_| "Invalid vault key".to_string())?;
  let plaintext = Zeroizing::new(cipher
    .decrypt(
      XNonce::from_slice(&nonce_bytes),
      chacha20poly1305::aead::Payload {
        msg: &ciphertext,
        aad: VAULT_AAD,
      },
    )
    .map_err(|_| "Vault could not be unlocked".to_string())?);

  serde_json::from_slice(&plaintext).map_err(|_| "Vault data is invalid".to_string())
}

fn read_envelope(app: &AppHandle) -> Result<VaultEnvelope, String> {
  let path = vault_path(app)?;
  let body = fs::read(&path).map_err(|_| "Vault does not exist".to_string())?;
  serde_json::from_slice(&body).map_err(|_| "Vault envelope is invalid".to_string())
}

fn write_envelope(app: &AppHandle, envelope: &VaultEnvelope) -> Result<(), String> {
  let path = vault_path(app)?;
  let temp = path.with_extension("tmp");
  let body = serde_json::to_vec(envelope).map_err(|e| e.to_string())?;

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

fn unlocked_key() -> Result<Zeroizing<Vec<u8>>, String> {
  let mut state = runtime().lock().map_err(|_| "Vault state unavailable".to_string())?;

  if let Some(last) = state.last_activity {
    if last.elapsed() >= AUTO_LOCK_AFTER {
      state.key = None;
      state.last_activity = None;
    }
  }

  let Some(key) = state.key.as_ref() else {
    return Err("Vault is locked".to_string());
  };

  state.last_activity = Some(Instant::now());
  Ok(Zeroizing::new(key.to_vec()))
}

fn load_payload(app: &AppHandle, key: &[u8]) -> Result<(VaultEnvelope, VaultPayload, Vec<u8>), String> {
  let envelope = read_envelope(app)?;
  let salt = BASE64
    .decode(&envelope.salt)
    .map_err(|_| "Invalid vault salt".to_string())?;
  let payload = decrypt_payload(&envelope, key)?;
  Ok((envelope, payload, salt))
}

#[tauri::command]
pub fn vault_status(app: AppHandle) -> Result<VaultStatus, String> {
  let exists = vault_path(&app)?.exists();
  let unlocked = if let Ok(mut state) = runtime().lock() {
    if let Some(last) = state.last_activity {
      if last.elapsed() >= AUTO_LOCK_AFTER {
        state.key = None;
        state.last_activity = None;
      }
    }
    state.key.is_some()
  } else {
    false
  };

  Ok(VaultStatus {
    exists,
    unlocked,
    auto_lock_seconds: AUTO_LOCK_AFTER.as_secs(),
  })
}

#[tauri::command]
pub fn vault_create(app: AppHandle, master_password: String) -> Result<VaultStatus, String> {
  let path = vault_path(&app)?;
  if path.exists() {
    return Err("Vault already exists".to_string());
  }

  let mut salt = [0_u8; 16];
  OsRng.fill_bytes(&mut salt);
  let key = derive_key(&master_password, &salt)?;
  let payload = VaultPayload::default();
  let envelope = encrypt_payload(&payload, &key, &salt)?;
  write_envelope(&app, &envelope)?;

  let mut state = runtime().lock().map_err(|_| "Vault state unavailable".to_string())?;
  state.key = Some(key);
  state.last_activity = Some(Instant::now());

  Ok(VaultStatus {
    exists: true,
    unlocked: true,
    auto_lock_seconds: AUTO_LOCK_AFTER.as_secs(),
  })
}

#[tauri::command]
pub fn vault_unlock(app: AppHandle, master_password: String) -> Result<VaultStatus, String> {
  let envelope = read_envelope(&app)?;
  let salt = BASE64
    .decode(&envelope.salt)
    .map_err(|_| "Invalid vault salt".to_string())?;
  let key = derive_key(&master_password, &salt)?;

  decrypt_payload(&envelope, &key)?;

  let mut state = runtime().lock().map_err(|_| "Vault state unavailable".to_string())?;
  state.key = Some(key);
  state.last_activity = Some(Instant::now());

  Ok(VaultStatus {
    exists: true,
    unlocked: true,
    auto_lock_seconds: AUTO_LOCK_AFTER.as_secs(),
  })
}

#[tauri::command]
pub fn vault_lock() -> Result<(), String> {
  let mut state = runtime().lock().map_err(|_| "Vault state unavailable".to_string())?;
  state.key = None;
  state.last_activity = None;
  Ok(())
}

#[tauri::command]
pub fn vault_list_entries(app: AppHandle) -> Result<Vec<VaultEntrySummary>, String> {
  let key = unlocked_key()?;
  let (_, payload, _) = load_payload(&app, &key)?;

  Ok(
    payload
      .entries
      .into_iter()
      .map(|entry| VaultEntrySummary {
        id: entry.id,
        label: entry.label,
        username: entry.username,
        url: entry.url,
        notes: entry.notes,
        created_at_epoch: entry.created_at_epoch,
        updated_at_epoch: entry.updated_at_epoch,
      })
      .collect(),
  )
}

#[tauri::command]
pub fn vault_add_entry(
  app: AppHandle,
  label: String,
  username: String,
  secret: String,
  url: String,
  notes: String,
) -> Result<String, String> {
  if label.trim().is_empty() {
    return Err("Vault entry label is required".to_string());
  }
  if secret.is_empty() {
    return Err("Vault secret is required".to_string());
  }

  let key = unlocked_key()?;
  let (_, mut payload, salt) = load_payload(&app, &key)?;
  let now = now_epoch();
  let id = Uuid::new_v4().to_string();

  payload.entries.push(VaultEntry {
    id: id.clone(),
    label: label.trim().to_string(),
    username: username.trim().to_string(),
    secret,
    url: url.trim().to_string(),
    notes: notes.trim().to_string(),
    created_at_epoch: now,
    updated_at_epoch: now,
  });

  let envelope = encrypt_payload(&payload, &key, &salt)?;
  write_envelope(&app, &envelope)?;
  Ok(id)
}

#[tauri::command]
pub fn vault_get_secret(app: AppHandle, entry_id: String) -> Result<String, String> {
  let key = unlocked_key()?;
  let (_, payload, _) = load_payload(&app, &key)?;

  payload
    .entries
    .into_iter()
    .find(|entry| entry.id == entry_id)
    .map(|entry| entry.secret)
    .ok_or_else(|| "Vault entry not found".to_string())
}

#[tauri::command]
pub fn vault_remove_entry(app: AppHandle, entry_id: String) -> Result<(), String> {
  let key = unlocked_key()?;
  let (_, mut payload, salt) = load_payload(&app, &key)?;
  let before = payload.entries.len();
  payload.entries.retain(|entry| entry.id != entry_id);

  if payload.entries.len() == before {
    return Err("Vault entry not found".to_string());
  }

  let envelope = encrypt_payload(&payload, &key, &salt)?;
  write_envelope(&app, &envelope)
}
