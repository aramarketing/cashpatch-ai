mod base {
  include!("scan_base.rs");
}

pub use base::{LocalFinding, QuickScanPlan, ScanSnapshot};

#[path = "scan_journal.rs"]
mod scan_journal;

use serde::Serialize;
use std::{
  path::PathBuf,
  sync::{Mutex, OnceLock},
  thread,
  time::Duration,
};
use tauri::AppHandle;

static JOURNAL_ROOTS: OnceLock<Mutex<Vec<PathBuf>>> = OnceLock::new();

fn root_cache() -> &'static Mutex<Vec<PathBuf>> {
  JOURNAL_ROOTS.get_or_init(|| Mutex::new(Vec::new()))
}

fn set_journal_roots(roots: Vec<String>) {
  if let Ok(mut cached) = root_cache().lock() {
    *cached = roots.into_iter().map(PathBuf::from).collect();
  }
}

fn cached_roots() -> Vec<PathBuf> {
  root_cache()
    .lock()
    .map(|roots| roots.clone())
    .unwrap_or_default()
}

fn update_roots_from_snapshot(snapshot: &ScanSnapshot) {
  if let Some(plan) = &snapshot.quick_plan {
    set_journal_roots(plan.roots.clone());
  }
}

fn persist_snapshot_now() {
  let snapshot = base::scan_status();
  update_roots_from_snapshot(&snapshot);
  let _ = scan_journal::persist_snapshot(&snapshot, &cached_roots());
}

fn start_journal_watcher(stop_at_full_confirmation: bool) {
  thread::spawn(move || loop {
    let snapshot = base::scan_status();
    update_roots_from_snapshot(&snapshot);
    let _ = scan_journal::persist_snapshot(&snapshot, &cached_roots());

    let terminal = matches!(snapshot.phase.as_str(), "completed" | "cancelled" | "failed");
    if terminal || (stop_at_full_confirmation && snapshot.phase == "awaiting_full_confirmation") {
      break;
    }

    thread::sleep(Duration::from_millis(500));
  });
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanStatusView {
  #[serde(flatten)]
  snapshot: ScanSnapshot,
  recovery: scan_journal::ScanRecoveryStatus,
  history: Vec<scan_journal::ScanHistoryEntry>,
}

fn recovery_fallback(error: String) -> scan_journal::ScanRecoveryStatus {
  scan_journal::ScanRecoveryStatus {
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
    note: format!("Recovery journal is unavailable: {error}"),
  }
}

#[tauri::command]
pub fn scan_status() -> ScanStatusView {
  let snapshot = base::scan_status();
  let recovery = scan_journal::recovery_status().unwrap_or_else(recovery_fallback);
  let history = scan_journal::list_history().unwrap_or_default();
  ScanStatusView {
    snapshot,
    recovery,
    history,
  }
}

#[tauri::command]
pub fn quick_scan_start(
  app: AppHandle,
  consent: bool,
  extra_roots: Vec<String>,
  recover_interrupted: Option<bool>,
) -> Result<String, String> {
  if !consent {
    return Err("Explicit scan consent is required".to_string());
  }

  let recovering = recover_interrupted.unwrap_or(false);
  let requested_roots = if recovering {
    scan_journal::recovery_roots()?
  } else {
    extra_roots
  };

  let scan_id = base::quick_scan_start(app, consent, requested_roots.clone())?;
  if recovering {
    scan_journal::discard_recovery()?;
  }
  set_journal_roots(requested_roots);
  persist_snapshot_now();
  start_journal_watcher(true);
  Ok(scan_id)
}

#[tauri::command]
pub fn full_scan_start(app: AppHandle, scan_id: String, consent: bool) -> Result<(), String> {
  if !consent {
    return Err("Explicit Full Scan confirmation is required".to_string());
  }

  if base::scan_status().phase != "awaiting_full_confirmation" {
    return Err("Full Scan is available only after Quick Scan completes".to_string());
  }

  base::full_scan_start(app, scan_id, consent)?;
  persist_snapshot_now();
  start_journal_watcher(false);
  Ok(())
}

#[tauri::command]
pub fn scan_pause() -> Result<(), String> {
  base::scan_pause()?;
  persist_snapshot_now();
  Ok(())
}

#[tauri::command]
pub fn scan_resume() -> Result<(), String> {
  base::scan_resume()?;
  persist_snapshot_now();
  Ok(())
}

#[tauri::command]
pub fn scan_cancel() -> Result<(), String> {
  base::scan_cancel()?;
  persist_snapshot_now();
  Ok(())
}

#[tauri::command]
pub fn scan_export_report(path: String, format: String) -> Result<(), String> {
  base::scan_export_report(path, format)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn status_view_serializes_recovery_and_history_without_changing_scan_fields() {
    let json = serde_json::to_value(scan_status()).expect("status should serialize");
    assert!(json.get("phase").is_some());
    assert!(json.get("recovery").is_some());
    assert!(json.get("history").is_some());
  }
}
