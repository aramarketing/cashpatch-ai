use crate::scan::ScanSnapshot;
use serde::{Deserialize, Serialize};
use std::{
  fs,
  path::{Path, PathBuf},
  time::{SystemTime, UNIX_EPOCH},
};

const JOURNAL_VERSION: u32 = 1;
const HISTORY_VERSION: u32 = 1;
const MAX_HISTORY_ENTRIES: usize = 50;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JournalRecord {
  version: u32,
  scan_id: Option<String>,
  mode: String,
  phase: String,
  roots: Vec<String>,
  files_seen: u64,
  directories_seen: u64,
  bytes_seen: u64,
  permission_denied: u64,
  findings_count: u64,
  progress_percent: f64,
  elapsed_seconds: u64,
  saved_at_unix: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRecoveryStatus {
  pub available: bool,
  pub previous_scan_id: Option<String>,
  pub mode: Option<String>,
  pub phase: Option<String>,
  pub roots: Vec<String>,
  pub files_seen: u64,
  pub directories_seen: u64,
  pub bytes_seen: u64,
  pub progress_percent: f64,
  pub saved_at_unix: Option<u64>,
  pub note: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanHistoryEntry {
  pub scan_id: String,
  pub mode: String,
  pub status: String,
  pub files_seen: u64,
  pub directories_seen: u64,
  pub bytes_seen: u64,
  pub permission_denied: u64,
  pub findings_count: u64,
  pub elapsed_seconds: u64,
  pub finished_at_unix: u64,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryFile {
  version: u32,
  entries: Vec<ScanHistoryEntry>,
}

fn now_unix() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|duration| duration.as_secs())
    .unwrap_or(0)
}

fn storage_dir() -> Result<PathBuf, String> {
  #[cfg(target_os = "macos")]
  let base = std::env::var_os("HOME")
    .map(PathBuf::from)
    .map(|home| home.join("Library").join("Application Support"));

  #[cfg(target_os = "windows")]
  let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);

  #[cfg(not(any(target_os = "macos", target_os = "windows")))]
  let base = Some(std::env::temp_dir());

  let dir = base
    .ok_or("Local application-data directory is unavailable")?
    .join("CashPatch");

  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  make_private_dir(&dir)?;
  Ok(dir)
}

fn journal_path() -> Result<PathBuf, String> {
  Ok(storage_dir()?.join("scan-journal.json"))
}

fn history_path() -> Result<PathBuf, String> {
  Ok(storage_dir()?.join("scan-history.json"))
}

#[cfg(unix)]
fn make_private_dir(path: &Path) -> Result<(), String> {
  use std::os::unix::fs::PermissionsExt;
  fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())
}

#[cfg(not(unix))]
fn make_private_dir(_path: &Path) -> Result<(), String> {
  Ok(())
}

#[cfg(unix)]
fn make_private_file(path: &Path) -> Result<(), String> {
  use std::os::unix::fs::PermissionsExt;
  fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())
}

#[cfg(not(unix))]
fn make_private_file(_path: &Path) -> Result<(), String> {
  Ok(())
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
  let temp = path.with_extension("tmp");
  fs::write(&temp, bytes).map_err(|e| e.to_string())?;
  make_private_file(&temp)?;

  if path.exists() {
    fs::remove_file(path).map_err(|e| e.to_string())?;
  }
  fs::rename(&temp, path).map_err(|e| e.to_string())?;
  make_private_file(path)
}

fn is_recoverable_phase(phase: &str) -> bool {
  matches!(
    phase,
    "quick_scanning" | "awaiting_full_confirmation" | "full_scanning"
  )
}

fn record_from_snapshot(snapshot: &ScanSnapshot, roots: &[PathBuf]) -> JournalRecord {
  JournalRecord {
    version: JOURNAL_VERSION,
    scan_id: snapshot.scan_id.clone(),
    mode: snapshot.mode.clone(),
    phase: snapshot.phase.clone(),
    roots: roots.iter().map(|path| path.display().to_string()).collect(),
    files_seen: snapshot.files_seen,
    directories_seen: snapshot.directories_seen,
    bytes_seen: snapshot.bytes_seen,
    permission_denied: snapshot.permission_denied,
    findings_count: snapshot.findings_count,
    progress_percent: snapshot.progress_percent,
    elapsed_seconds: snapshot.elapsed_seconds,
    saved_at_unix: now_unix(),
  }
}

fn load_journal_record() -> Result<Option<JournalRecord>, String> {
  let path = journal_path()?;
  if !path.exists() {
    return Ok(None);
  }

  let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
  let record: JournalRecord = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
  if record.version != JOURNAL_VERSION {
    return Ok(None);
  }
  Ok(Some(record))
}

fn clear_journal() -> Result<(), String> {
  let path = journal_path()?;
  if path.exists() {
    fs::remove_file(path).map_err(|e| e.to_string())?;
  }
  Ok(())
}

fn load_history_file() -> Result<HistoryFile, String> {
  let path = history_path()?;
  if !path.exists() {
    return Ok(HistoryFile {
      version: HISTORY_VERSION,
      entries: Vec::new(),
    });
  }

  let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
  let mut history: HistoryFile = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
  if history.version != HISTORY_VERSION {
    history = HistoryFile {
      version: HISTORY_VERSION,
      entries: Vec::new(),
    };
  }
  Ok(history)
}

fn append_history(snapshot: &ScanSnapshot) -> Result<(), String> {
  let Some(scan_id) = snapshot.scan_id.clone() else {
    return Ok(());
  };

  let mut history = load_history_file()?;
  history.entries.retain(|entry| entry.scan_id != scan_id);
  history.entries.insert(
    0,
    ScanHistoryEntry {
      scan_id,
      mode: snapshot.mode.clone(),
      status: snapshot.phase.clone(),
      files_seen: snapshot.files_seen,
      directories_seen: snapshot.directories_seen,
      bytes_seen: snapshot.bytes_seen,
      permission_denied: snapshot.permission_denied,
      findings_count: snapshot.findings_count,
      elapsed_seconds: snapshot.elapsed_seconds,
      finished_at_unix: now_unix(),
    },
  );
  history.entries.truncate(MAX_HISTORY_ENTRIES);

  let body = serde_json::to_vec_pretty(&history).map_err(|e| e.to_string())?;
  atomic_write(&history_path()?, &body)
}

pub fn persist_snapshot(snapshot: &ScanSnapshot, roots: &[PathBuf]) -> Result<(), String> {
  if is_recoverable_phase(&snapshot.phase) {
    let record = record_from_snapshot(snapshot, roots);
    let body = serde_json::to_vec_pretty(&record).map_err(|e| e.to_string())?;
    atomic_write(&journal_path()?, &body)?;
    return Ok(());
  }

  if matches!(snapshot.phase.as_str(), "completed" | "cancelled" | "failed") {
    append_history(snapshot)?;
    clear_journal()?;
  }

  Ok(())
}

pub fn recovery_status() -> Result<ScanRecoveryStatus, String> {
  let Some(record) = load_journal_record()? else {
    return Ok(ScanRecoveryStatus {
      available: false,
      previous_scan_id: None,
      mode: None,
      phase: None,
      roots: Vec::new(),
      files_seen: 0,
      directories_seen: 0,
      bytes_seen: 0,
      progress_percent: 0.0,
      saved_at_unix: None,
      note: "No interrupted local scan is available.".to_string(),
    });
  };

  if !is_recoverable_phase(&record.phase) {
    return Ok(ScanRecoveryStatus {
      available: false,
      previous_scan_id: record.scan_id,
      mode: Some(record.mode),
      phase: Some(record.phase),
      roots: Vec::new(),
      files_seen: record.files_seen,
      directories_seen: record.directories_seen,
      bytes_seen: record.bytes_seen,
      progress_percent: record.progress_percent,
      saved_at_unix: Some(record.saved_at_unix),
      note: "The previous journal is not resumable.".to_string(),
    });
  }

  Ok(ScanRecoveryStatus {
    available: true,
    previous_scan_id: record.scan_id,
    mode: Some(record.mode),
    phase: Some(record.phase),
    roots: record.roots,
    files_seen: record.files_seen,
    directories_seen: record.directories_seen,
    bytes_seen: record.bytes_seen,
    progress_percent: record.progress_percent,
    saved_at_unix: Some(record.saved_at_unix),
    note: "An interrupted scan can be resumed safely only after explicit confirmation. CashPatch restarts the same approved scope from the beginning so changed files are not skipped.".to_string(),
  })
}

pub fn recovery_roots() -> Result<Vec<String>, String> {
  let status = recovery_status()?;
  if !status.available {
    return Err("No interrupted scan is available".to_string());
  }
  Ok(status.roots)
}

pub fn discard_recovery() -> Result<(), String> {
  clear_journal()
}

pub fn list_history() -> Result<Vec<ScanHistoryEntry>, String> {
  Ok(load_history_file()?.entries)
}

pub fn clear_history() -> Result<(), String> {
  let path = history_path()?;
  if path.exists() {
    fs::remove_file(path).map_err(|e| e.to_string())?;
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn only_interrupted_scan_phases_are_recoverable() {
    assert!(is_recoverable_phase("quick_scanning"));
    assert!(is_recoverable_phase("awaiting_full_confirmation"));
    assert!(is_recoverable_phase("full_scanning"));
    assert!(!is_recoverable_phase("completed"));
    assert!(!is_recoverable_phase("cancelled"));
    assert!(!is_recoverable_phase("idle"));
  }
}
