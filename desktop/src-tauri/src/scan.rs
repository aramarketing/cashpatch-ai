use blake3::Hasher;
use serde::Serialize;
use std::{
  collections::{BTreeMap, HashMap, HashSet},
  fs::File,
  io::Read,
  path::{Path, PathBuf},
  sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
  },
  thread,
  time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;
use walkdir::{DirEntry, WalkDir};

#[path = "scan_journal.rs"]
mod scan_journal;
#[path = "document_analysis.rs"]
mod document_analysis;

const QUICK_MAX_ENTRIES: u64 = 500_000;
const CONTENT_HASH_MAX_BYTES: u64 = 64 * 1024 * 1024;
const PROGRESS_EVERY_FILES: u64 = 200;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickScanPlan {
  pub roots: Vec<String>,
  pub files_seen: u64,
  pub directories_seen: u64,
  pub bytes_seen: u64,
  pub permission_denied: u64,
  pub installed_software_seen: u64,
  pub running_processes_seen: u64,
  pub network_interfaces_seen: u64,
  pub autostart_entries_seen: u64,
  pub security_checks_seen: u64,
  pub truncated: bool,
  pub estimated_full_seconds: u64,
  pub estimated_full_label: String,
}

#[derive(Clone, Serialize)]
#[serde(into = "LocalFindingView")]
pub struct LocalFinding {
  pub id: String,
  pub category: String,
  pub severity: String,
  pub title: String,
  pub summary: String,
  pub evidence: String,
  pub remediation: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalFindingView {
  id: String,
  category: String,
  severity: String,
  confidence: u8,
  financial_impact: String,
  title: String,
  summary: String,
  evidence: String,
  remediation: String,
}

fn finding_confidence(finding: &LocalFinding) -> u8 {
  match finding.title.as_str() {
    "Duplicate business file detected" => 100,
    "Duplicate invoice number detected" => 92,
    "Large stale file worth reviewing" => 95,
    "Some locations could not be read" => 100,
    "Potential plaintext credential file" => 65,
    _ if finding.category == "vulnerability" => 90,
    _ if finding.category == "finance" || finding.category == "cost_efficiency" => 80,
    _ => 70,
  }
}

fn finding_financial_impact(finding: &LocalFinding) -> String {
  match finding.category.as_str() {
    "finance" => "Possible duplicate charge, overpayment or billing correction. Verify the exact amount against payment records before acting.".to_string(),
    "cost_efficiency" => "Potential avoidable storage, subscription or administrative cost. Exact savings are not assumed until a human verifies the source.".to_string(),
    "efficiency" => "Possible storage or administration savings; CashPatch does not assign a monetary value without supporting evidence.".to_string(),
    "vulnerability" | "security" => "Primarily risk reduction. A direct monetary amount is not claimed without evidence.".to_string(),
    _ => "No direct monetary impact calculated for this finding.".to_string(),
  }
}

impl From<LocalFinding> for LocalFindingView {
  fn from(finding: LocalFinding) -> Self {
    let confidence = finding_confidence(&finding);
    let financial_impact = finding_financial_impact(&finding);
    Self {
      id: finding.id,
      category: finding.category,
      severity: finding.severity,
      confidence,
      financial_impact,
      title: finding.title,
      summary: finding.summary,
      evidence: finding.evidence,
      remediation: finding.remediation,
    }
  }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSnapshot {
  pub scan_id: Option<String>,
  pub mode: String,
  pub phase: String,
  pub current_item: Option<String>,
  pub files_seen: u64,
  pub directories_seen: u64,
  pub bytes_seen: u64,
  pub permission_denied: u64,
  pub findings_count: u64,
  pub progress_percent: f64,
  pub elapsed_seconds: u64,
  pub eta_seconds: Option<u64>,
  pub paused: bool,
  pub cancelled: bool,
  pub quick_plan: Option<QuickScanPlan>,
  pub findings: Vec<LocalFinding>,
  pub error: Option<String>,
  pub coverage_warnings: Vec<String>,
  pub ai_documents_reviewed: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanStatusView {
  #[serde(flatten)]
  snapshot: ScanSnapshot,
  recovery: scan_journal::ScanRecoveryStatus,
  history: Vec<scan_journal::ScanHistoryEntry>,
}

struct ScanRuntime {
  snapshot: ScanSnapshot,
  started_at: Option<Instant>,
  roots: Vec<PathBuf>,
  pause: Arc<AtomicBool>,
  cancel: Arc<AtomicBool>,
}

impl Default for ScanRuntime {
  fn default() -> Self {
    Self {
      snapshot: ScanSnapshot {
        scan_id: None,
        mode: "none".to_string(),
        phase: "idle".to_string(),
        current_item: None,
        files_seen: 0,
        directories_seen: 0,
        bytes_seen: 0,
        permission_denied: 0,
        findings_count: 0,
        progress_percent: 0.0,
        elapsed_seconds: 0,
        eta_seconds: None,
        paused: false,
        cancelled: false,
        quick_plan: None,
        findings: Vec::new(),
        error: None,
        coverage_warnings: Vec::new(),
        ai_documents_reviewed: 0,
      },
      started_at: None,
      roots: Vec::new(),
      pause: Arc::new(AtomicBool::new(false)),
      cancel: Arc::new(AtomicBool::new(false)),
    }
  }
}

static SCAN_RUNTIME: OnceLock<Arc<Mutex<ScanRuntime>>> = OnceLock::new();

fn runtime() -> &'static Arc<Mutex<ScanRuntime>> {
  SCAN_RUNTIME.get_or_init(|| Arc::new(Mutex::new(ScanRuntime::default())))
}

fn emit_snapshot(app: &AppHandle) {
  let payload = runtime()
    .lock()
    .ok()
    .map(|state| (state.snapshot.clone(), state.roots.clone()));

  if let Some((snapshot, roots)) = payload {
    let _ = scan_journal::persist_snapshot(&snapshot, &roots);
    let _ = app.emit("scan-progress", snapshot);
  }
}

fn default_roots() -> Vec<PathBuf> {
  let mut roots = Vec::<PathBuf>::new();

  #[cfg(target_os = "macos")]
  {
    if let Some(home) = std::env::var_os("HOME") {
      roots.push(PathBuf::from(home));
    }
    roots.push(PathBuf::from("/Applications"));
    roots.push(PathBuf::from("/Library/LaunchAgents"));
    roots.push(PathBuf::from("/Library/LaunchDaemons"));
  }

  #[cfg(target_os = "windows")]
  {
    if let Some(profile) = std::env::var_os("USERPROFILE") {
      roots.push(PathBuf::from(profile));
    }
    if let Some(path) = std::env::var_os("ProgramFiles") {
      roots.push(PathBuf::from(path));
    }
    if let Some(path) = std::env::var_os("ProgramFiles(x86)") {
      roots.push(PathBuf::from(path));
    }
  }

  roots.sort();
  roots.dedup();
  roots.into_iter().filter(|p| p.exists()).collect()
}

// An explicitly selected scope must never expand to the whole computer.
fn resolve_roots(requested: Vec<String>) -> Result<Vec<PathBuf>, String> {
  let candidates = if requested.is_empty() {
    default_roots()
  } else {
    requested.into_iter().map(PathBuf::from).collect()
  };
  let mut roots = Vec::new();
  for path in candidates {
    let canonical = path.canonicalize().map_err(|_| format!("Scan folder is unavailable: {}", path.display()))?;
    if !canonical.is_dir() {
      return Err(format!("Scan root must be a folder: {}", path.display()));
    }
    roots.push(canonical);
  }
  roots.sort();
  roots.dedup();
  let selected = roots.clone();
  roots.retain(|path| !selected.iter().any(|parent| parent != path && path.starts_with(parent)));
  if roots.is_empty() {
    return Err("No readable scan roots are available".to_string());
  }
  Ok(roots)
}

fn skip_entry(entry: &DirEntry) -> bool {
  if entry.depth() == 0 {
    return false;
  }

  let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
  matches!(
    name.as_str(),
    ".git"
      | "node_modules"
      | "target"
      | "__pycache__"
      | ".cache"
      | "cache"
      | "caches"
      | ".trash"
      | ".trashes"
      | "deriveddata"
      | "containers"
  )
}

fn business_extension(path: &Path) -> bool {
  let ext = path
    .extension()
    .and_then(|v| v.to_str())
    .unwrap_or_default()
    .to_ascii_lowercase();

  matches!(
    ext.as_str(),
    "pdf"
      | "txt"
      | "md"
      | "csv"
      | "json"
      | "xml"
      | "html"
      | "doc"
      | "docx"
      | "xls"
      | "xlsx"
      | "ods"
      | "odt"
      | "ppt"
      | "pptx"
      | "eml"
      | "msg"
      | "rtf"
      | "log"
  )
}

fn sensitive_filename(path: &Path) -> bool {
  let name = path
    .file_name()
    .and_then(|v| v.to_str())
    .unwrap_or_default()
    .to_ascii_lowercase();

  ["password", "passwd", "credential", "credentials", "secret", "apikey", "api_key", "token"]
    .iter()
    .any(|needle| name.contains(needle))
}

const MAX_LOCAL_AI_DOCUMENTS_PER_SCAN: u64 = 2_500;

#[derive(Clone)]
struct FullScanLocalAi {
  provider: String,
  endpoint: Option<String>,
  model: String,
}

fn discover_full_scan_local_ai() -> Option<FullScanLocalAi> {
  let mut candidates = vec![
    ("ollama".to_string(), None),
    ("lm-studio".to_string(), None),
  ];

  if let Some(endpoint) = crate::secret_get("local-ai-jev-endpoint") {
    candidates.push(("jev".to_string(), Some(endpoint)));
  }
  if let Some(endpoint) = crate::secret_get("local-ai-custom-endpoint") {
    candidates.push(("custom-local".to_string(), Some(endpoint)));
  }

  for (provider, endpoint) in candidates {
    let models = tauri::async_runtime::block_on(crate::local_ai::local_ai_models(
      provider.clone(),
      endpoint.clone(),
    ));
    if let Ok(models) = models {
      if let Some(model) = models.into_iter().next() {
        return Some(FullScanLocalAi { provider, endpoint, model: model.id });
      }
    }
  }
  None
}

fn local_ai_review_document(
  local_ai: &FullScanLocalAi,
  path: &Path,
  text: String,
  cancel: &AtomicBool,
) -> Result<(Vec<LocalFinding>, bool), String> {
  let task = format!(
    "Review this user-approved local business document for contradictions, unresolved obligations, duplicate or suspicious costs, contract or invoice anomalies, security concerns and efficiency risks. Source path: {}. Do not execute or recommend autonomous changes.",
    path.display()
  );
  let ai = local_ai.clone();
  let (sender, receiver) = std::sync::mpsc::channel();
  let request = tauri::async_runtime::spawn(async move {
    let result = crate::local_ai::local_ai_analyze_text(
      ai.provider, ai.endpoint, ai.model, text, Some(task), true,
    ).await;
    let _ = sender.send(result);
  });
  let analysis = loop {
    if cancel.load(Ordering::Relaxed) {
      request.abort();
      return Err("Local AI review cancelled".to_string());
    }
    match receiver.recv_timeout(Duration::from_millis(100)) {
      Ok(result) => break result?,
      Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
      Err(_) => return Err("Local AI review task stopped".to_string()),
    }
  };
  let truncated = analysis.input_truncated;

  let findings = analysis.findings.into_iter().map(|finding| LocalFinding {
    id: Uuid::new_v4().to_string(),
    category: format!("local_ai_review:{}", finding.category),
    severity: finding.severity,
    title: format!("Local AI advisory: {}", finding.title),
    summary: format!(
      "Local-only {} model {} flagged this for human verification. {}",
      analysis.provider, analysis.model, finding.summary
    ),
    evidence: format!("{} :: {}", path.display(), finding.evidence),
    remediation: format!(
      "Review the source manually. {} CashPatch will not execute, edit, send, delete, pay or otherwise change anything.",
      finding.remediation
    ),
  }).collect();
  Ok((findings, truncated))
}

fn format_eta(seconds: u64) -> String {
  if seconds < 60 {
    return format!("about {} seconds", seconds.max(1));
  }
  if seconds < 3600 {
    return format!("about {} minutes", ((seconds + 59) / 60).max(1));
  }
  let hours = (seconds + 3599) / 3600;
  format!("about {} hour{}", hours, if hours == 1 { "" } else { "s" })
}

fn estimate_full_seconds(files: u64, bytes: u64) -> u64 {
  let by_files = (files / 45).max(1);
  let by_bytes = (bytes / (90 * 1024 * 1024)).max(1);
  by_files.max(by_bytes)
}

fn progress_percent(current: u64, total: u64) -> f64 {
  if total == 0 {
    0.0
  } else {
    ((current as f64 / total as f64) * 100.0).clamp(0.0, 100.0)
  }
}

fn hash_file(path: &Path) -> Result<String, String> {
  let mut file = File::open(path).map_err(|e| e.to_string())?;
  let mut hasher = Hasher::new();
  let mut buffer = [0_u8; 64 * 1024];

  loop {
    let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
    if read == 0 {
      break;
    }
    hasher.update(&buffer[..read]);
  }

  Ok(hasher.finalize().to_hex().to_string())
}

fn wait_if_paused(pause: &AtomicBool, cancel: &AtomicBool) -> bool {
  while pause.load(Ordering::Relaxed) {
    if cancel.load(Ordering::Relaxed) {
      return false;
    }
    thread::sleep(Duration::from_millis(120));
  }
  !cancel.load(Ordering::Relaxed)
}

fn set_terminal_phase(app: &AppHandle, phase: &str) {
  if let Ok(mut state) = runtime().lock() {
    state.snapshot.phase = phase.to_string();
    state.snapshot.progress_percent = if phase == "completed" { 100.0 } else { state.snapshot.progress_percent };
    state.snapshot.cancelled = phase == "cancelled";
    state.snapshot.paused = false;
    state.snapshot.current_item = None;
    if let Some(started) = state.started_at {
      state.snapshot.elapsed_seconds = started.elapsed().as_secs();
    }
  }
  emit_snapshot(app);
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
  let snapshot = runtime()
    .lock()
    .map(|state| state.snapshot.clone())
    .unwrap_or_else(|_| ScanRuntime::default().snapshot);
  let recovery = scan_journal::recovery_status().unwrap_or_else(recovery_fallback);
  let history = scan_journal::list_history().unwrap_or_default();

  ScanStatusView {
    snapshot,
    recovery,
    history,
  }
}

pub fn quick_scan_start(
  app: AppHandle,
  consent: bool,
  extra_roots: Vec<String>,
  recover_interrupted: Option<bool>,
) -> Result<String, String> {
  if !consent {
    return Err("Explicit scan consent is required".to_string());
  }

  let requested_roots = if recover_interrupted.unwrap_or(false) {
    scan_journal::recovery_roots()?
  } else {
    extra_roots
  };

  let roots = resolve_roots(requested_roots)?;

  let scan_id = Uuid::new_v4().to_string();
  let pause = Arc::new(AtomicBool::new(false));
  let cancel = Arc::new(AtomicBool::new(false));

  {
    let mut state = runtime().lock().map_err(|_| "Scan state is unavailable")?;
    if matches!(state.snapshot.phase.as_str(), "quick_scanning" | "full_scanning") {
      return Err("A scan is already running".to_string());
    }

    state.snapshot = ScanSnapshot {
      scan_id: Some(scan_id.clone()),
      mode: "quick".to_string(),
      phase: "quick_scanning".to_string(),
      current_item: None,
      files_seen: 0,
      directories_seen: 0,
      bytes_seen: 0,
      permission_denied: 0,
      findings_count: 0,
      progress_percent: 0.0,
      elapsed_seconds: 0,
      eta_seconds: None,
      paused: false,
      cancelled: false,
      quick_plan: None,
      findings: Vec::new(),
      error: None,
      coverage_warnings: Vec::new(),
      ai_documents_reviewed: 0,
    };
    state.started_at = Some(Instant::now());
    state.roots = roots.clone();
    state.pause = pause.clone();
    state.cancel = cancel.clone();
  }

  emit_snapshot(&app);

  let app_for_thread = app.clone();
  let scan_id_for_thread = scan_id.clone();
  thread::spawn(move || {
    let mut files = 0_u64;
    let mut dirs = 0_u64;
    let mut bytes = 0_u64;
    let mut denied = 0_u64;
    let mut truncated = false;
    let started = Instant::now();

    'roots: for root in &roots {
      let walker = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| !skip_entry(entry));

      for entry in walker {
        if !wait_if_paused(&pause, &cancel) {
          set_terminal_phase(&app_for_thread, "cancelled");
          return;
        }

        match entry {
          Ok(entry) => {
            if entry.file_type().is_dir() {
              dirs = dirs.saturating_add(1);
            } else if entry.file_type().is_file() {
              files = files.saturating_add(1);
              if let Ok(metadata) = entry.metadata() {
                bytes = bytes.saturating_add(metadata.len());
              }
            }

            if let Ok(mut state) = runtime().lock() {
              state.snapshot.current_item = Some(entry.path().display().to_string());
              state.snapshot.files_seen = files;
              state.snapshot.directories_seen = dirs;
              state.snapshot.bytes_seen = bytes;
              state.snapshot.permission_denied = denied;
              state.snapshot.elapsed_seconds = started.elapsed().as_secs();
            }

            if (files + dirs) % PROGRESS_EVERY_FILES == 0 {
              emit_snapshot(&app_for_thread);
            }

            if files.saturating_add(dirs) >= QUICK_MAX_ENTRIES {
              truncated = true;
              break 'roots;
            }
          }
          Err(_) => {
            denied = denied.saturating_add(1);
          }
        }
      }
    }

    if let Ok(mut state) = runtime().lock() {
      state.snapshot.current_item = Some("System inventory: programs, processes, network interfaces and autostart".to_string());
    }
    emit_snapshot(&app_for_thread);
    let inventory = crate::inventory::collect_system_inventory();
    let security_posture = crate::security_posture::collect_security_posture();

    let estimated = estimate_full_seconds(files, bytes);
    let plan = QuickScanPlan {
      roots: roots.iter().map(|p| p.display().to_string()).collect(),
      files_seen: files,
      directories_seen: dirs,
      bytes_seen: bytes,
      permission_denied: denied,
      installed_software_seen: inventory.installed_software.len() as u64,
      running_processes_seen: inventory.running_processes.len() as u64,
      network_interfaces_seen: inventory.network_interfaces.len() as u64,
      autostart_entries_seen: inventory.autostart_entries.len() as u64,
      security_checks_seen: security_posture.checks.len() as u64,
      truncated,
      estimated_full_seconds: estimated,
      estimated_full_label: format_eta(estimated),
    };

    if let Ok(mut state) = runtime().lock() {
      if state.snapshot.scan_id.as_deref() != Some(scan_id_for_thread.as_str()) {
        return;
      }
      state.snapshot.mode = "quick".to_string();
      state.snapshot.phase = "awaiting_full_confirmation".to_string();
      state.snapshot.current_item = None;
      state.snapshot.files_seen = files;
      state.snapshot.directories_seen = dirs;
      state.snapshot.bytes_seen = bytes;
      state.snapshot.permission_denied = denied;
      state.snapshot.progress_percent = 100.0;
      state.snapshot.elapsed_seconds = started.elapsed().as_secs();
      state.snapshot.eta_seconds = Some(estimated);
      state.snapshot.quick_plan = Some(plan);
    }
    emit_snapshot(&app_for_thread);
  });

  Ok(scan_id)
}

pub fn full_scan_start(app: AppHandle, scan_id: String, consent: bool) -> Result<(), String> {
  if !consent {
    return Err("Explicit Full Scan confirmation is required".to_string());
  }

  let (roots, quick_plan, pause, cancel) = {
    let mut state = runtime().lock().map_err(|_| "Scan state is unavailable")?;
    if state.snapshot.scan_id.as_deref() != Some(scan_id.as_str()) {
      return Err("Quick Scan session does not match".to_string());
    }
    if state.snapshot.phase != "awaiting_full_confirmation" {
      return Err("Full Scan is available only after Quick Scan completes".to_string());
    }

    state.snapshot.mode = "full".to_string();
    state.snapshot.phase = "full_scanning".to_string();
    state.snapshot.current_item = None;
    state.snapshot.files_seen = 0;
    state.snapshot.directories_seen = 0;
    state.snapshot.bytes_seen = 0;
    state.snapshot.permission_denied = 0;
    state.snapshot.findings_count = 0;
    state.snapshot.progress_percent = 0.0;
    state.snapshot.elapsed_seconds = 0;
    state.snapshot.paused = false;
    state.snapshot.cancelled = false;
    state.snapshot.findings.clear();
    state.snapshot.error = None;
    state.started_at = Some(Instant::now());
    state.pause.store(false, Ordering::Relaxed);
    state.cancel.store(false, Ordering::Relaxed);

    (
      state.roots.clone(),
      state.snapshot.quick_plan.clone(),
      state.pause.clone(),
      state.cancel.clone(),
    )
  };

  let expected_files = quick_plan.as_ref().map(|p| p.files_seen).unwrap_or(0);
  emit_snapshot(&app);

  thread::spawn(move || {
    let started = Instant::now();
    let mut files = 0_u64;
    let mut dirs = 0_u64;
    let mut bytes = 0_u64;
    let mut denied = 0_u64;
    let mut hashes: HashMap<(u64, String), PathBuf> = HashMap::new();
    let mut duplicate_groups = BTreeMap::<String, u64>::new();
    let mut invoice_numbers = HashMap::<String, (PathBuf, Option<String>)>::new();
    let mut reported_invoice_numbers = HashSet::<String>::new();
    let mut findings = Vec::<LocalFinding>::new();
    let local_ai = discover_full_scan_local_ai();
    let mut local_ai_documents_reviewed = 0_u64;
    let mut ai_failures = 0_u64;
    let mut ai_truncated = 0_u64;
    let mut warnings = Vec::<String>::new();
    if local_ai.is_none() {
      warnings.push("No local AI model is available. Only deterministic checks ran; document meaning was not reviewed by AI.".to_string());
    }

    if let Some(ai) = &local_ai {
      if let Ok(mut state) = runtime().lock() {
        state.snapshot.current_item = Some(format!("Local AI ready: {} · {}", ai.provider, ai.model));
      }
      emit_snapshot(&app);
    }

    for root in &roots {
      let walker = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| !skip_entry(entry));

      for entry in walker {
        if !wait_if_paused(&pause, &cancel) {
          set_terminal_phase(&app, "cancelled");
          return;
        }

        match entry {
          Ok(entry) => {
            let path = entry.path();

            if entry.file_type().is_dir() {
              dirs = dirs.saturating_add(1);
            } else if entry.file_type().is_file() {
              files = files.saturating_add(1);
              let metadata = match entry.metadata() {
                Ok(metadata) => metadata,
                Err(_) => {
                  denied = denied.saturating_add(1);
                  continue;
                }
              };
              let len = metadata.len();
              bytes = bytes.saturating_add(len);

              if sensitive_filename(path) && business_extension(path) {
                findings.push(LocalFinding {
                  id: Uuid::new_v4().to_string(),
                  category: "security".to_string(),
                  severity: "medium".to_string(),
                  title: "Potential plaintext credential file".to_string(),
                  summary: "A business-readable file name suggests that passwords, API keys or credentials may be stored in a normal document.".to_string(),
                  evidence: path.display().to_string(),
                  remediation: "Review the file manually and move any secrets into a dedicated encrypted password vault. CashPatch did not read or expose the secret value.".to_string(),
                });
              }

              if business_extension(path) {
                if let Ok(Some(signals)) = document_analysis::analyze_document(path, len) {
                  if let Some(invoice) = signals.invoice {
                    if let Some((first_path, first_amount)) = invoice_numbers.get(&invoice.invoice_number) {
                      if first_path != path && reported_invoice_numbers.insert(invoice.invoice_number.clone()) {
                        let totals_differ = matches!(
                          (first_amount.as_deref(), invoice.amount.as_deref()),
                          (Some(first), Some(current)) if first != current
                        );
                        let amount_note = match (first_amount.as_deref(), invoice.amount.as_deref()) {
                          (Some(first), Some(current)) if first != current => {
                            format!(" The totals differ ({first} vs. {current}).")
                          }
                          (Some(amount), Some(_)) => format!(" Both documents show total {amount}."),
                          _ => String::new(),
                        };
                        let recurring_note = if invoice.recurring_hint {
                          " The document also contains recurring/subscription language."
                        } else {
                          ""
                        };

                        findings.push(LocalFinding {
                          id: Uuid::new_v4().to_string(),
                          category: "finance".to_string(),
                          severity: if totals_differ { "high" } else { "medium" }.to_string(),
                          title: "Duplicate invoice number detected".to_string(),
                          summary: format!(
                            "Two locally reviewed documents use invoice number {}.{}{}",
                            invoice.invoice_number, amount_note, recurring_note
                          ),
                          evidence: format!("{} :: {}", first_path.display(), path.display()),
                          remediation: "Compare both invoices and the corresponding payment records manually. Confirm whether this is a duplicate bill, a corrected invoice or an intentional copy before taking any action. CashPatch never pays, refunds, deletes or edits anything.".to_string(),
                        });
                      }
                    } else {
                      invoice_numbers.insert(
                        invoice.invoice_number.clone(),
                        (path.to_path_buf(), invoice.amount.clone()),
                      );
                    }
                  }
                }
              }

              if business_extension(path)
                && !sensitive_filename(path)
                && local_ai_documents_reviewed < MAX_LOCAL_AI_DOCUMENTS_PER_SCAN
              {
                if let (Some(ai), Ok(Some(text))) =
                  (local_ai.as_ref(), document_analysis::extract_document_text(path, len))
                {
                  if !text.trim().is_empty() {
                    local_ai_documents_reviewed = local_ai_documents_reviewed.saturating_add(1);
                    if let Ok(mut state) = runtime().lock() {
                      state.snapshot.current_item = Some(format!("Local AI advisory review: {}", path.display()));
                    }
                    emit_snapshot(&app);
                    match local_ai_review_document(ai, path, text, &cancel) {
                      Ok((items, truncated)) => {
                        findings.extend(items);
                        ai_truncated += u64::from(truncated);
                      }
                      Err(_) => ai_failures += 1,
                    }
                    if !wait_if_paused(&pause, &cancel) {
                      set_terminal_phase(&app, "cancelled");
                      return;
                    }
                  }
                }
              }

              if business_extension(path) && len > 0 && len <= CONTENT_HASH_MAX_BYTES {
                if let Ok(hash) = hash_file(path) {
                  let key = (len, hash.clone());
                  if let Some(first) = hashes.get(&key) {
                    let group = format!("{} :: {}", first.display(), path.display());
                    duplicate_groups.entry(group).or_insert(2);
                  } else {
                    hashes.insert(key, path.to_path_buf());
                  }
                }
              }

              if len >= 1024 * 1024 * 1024 {
                if let Ok(modified) = metadata.modified() {
                  if let Ok(age) = SystemTime::now().duration_since(modified) {
                    if age.as_secs() > 730 * 24 * 3600 {
                      findings.push(LocalFinding {
                        id: Uuid::new_v4().to_string(),
                        category: "efficiency".to_string(),
                        severity: "low".to_string(),
                        title: "Large stale file worth reviewing".to_string(),
                        summary: "A file larger than 1 GB has not been modified for more than two years.".to_string(),
                        evidence: path.display().to_string(),
                        remediation: "Review whether this file is still required. CashPatch will never delete or move it.".to_string(),
                      });
                    }
                  }
                }
              }
            }

            let percent = progress_percent(files, expected_files);
            let elapsed = started.elapsed().as_secs();
            let eta = if files > 0 && expected_files > files {
              let rate = files as f64 / started.elapsed().as_secs_f64().max(1.0);
              Some(((expected_files - files) as f64 / rate.max(0.1)) as u64)
            } else {
              None
            };

            if let Ok(mut state) = runtime().lock() {
              state.snapshot.current_item = Some(path.display().to_string());
              state.snapshot.files_seen = files;
              state.snapshot.directories_seen = dirs;
              state.snapshot.bytes_seen = bytes;
              state.snapshot.permission_denied = denied;
              state.snapshot.findings_count = findings.len() as u64 + duplicate_groups.len() as u64;
              state.snapshot.progress_percent = percent;
              state.snapshot.elapsed_seconds = elapsed;
              state.snapshot.eta_seconds = eta;
              state.snapshot.paused = pause.load(Ordering::Relaxed);
            }

            if files % PROGRESS_EVERY_FILES == 0 {
              emit_snapshot(&app);
            }
          }
          Err(_) => {
            denied = denied.saturating_add(1);
          }
        }
      }
    }

    if !wait_if_paused(&pause, &cancel) {
      set_terminal_phase(&app, "cancelled");
      return;
    }
    for (evidence, count) in duplicate_groups {
      findings.push(LocalFinding {
        id: Uuid::new_v4().to_string(),
        category: "cost_efficiency".to_string(),
        severity: "low".to_string(),
        title: "Duplicate business file detected".to_string(),
        summary: format!("At least {} files have identical content.", count),
        evidence,
        remediation: "Review the duplicates manually before deleting anything. CashPatch never removes files.".to_string(),
      });
    }

    if !crate::inventory::vulnerability::vulnerability_database_status(app.clone())
      .map(|status| status.available).unwrap_or(false) {
      warnings.push("Known software vulnerabilities were not checked: no usable local vulnerability database is installed.".to_string());
    }
    if let Ok(vulnerabilities) =
      crate::inventory::vulnerability::analyze_current_system_from_local_database(&app)
    {
      for vulnerability in vulnerabilities {
        let reference = vulnerability
          .reference
          .clone()
          .unwrap_or_else(|| vulnerability.vulnerability_id.clone());
        let fixed_note = vulnerability
          .fixed_version
          .as_deref()
          .map(|version| format!(" Update to version {version} or later if the vendor confirms it."))
          .unwrap_or_else(|| " Review the vendor's current supported release.".to_string());

        findings.push(LocalFinding {
          id: Uuid::new_v4().to_string(),
          category: "vulnerability".to_string(),
          severity: vulnerability.severity.clone(),
          title: format!("Known vulnerability in {}", vulnerability.software_name),
          summary: format!(
            "{} version {} matches {} in the verified local vulnerability database. {}",
            vulnerability.software_name,
            vulnerability.installed_version,
            vulnerability.vulnerability_id,
            vulnerability.summary
          ),
          evidence: format!(
            "{} · installed version {} · {}",
            vulnerability.vulnerability_id, vulnerability.installed_version, reference
          ),
          remediation: format!(
            "Review the vendor advisory and update the application manually.{} CashPatch will never install, remove or modify software by itself.",
            fixed_note
          ),
        });
      }
    }

    let security_posture = crate::security_posture::collect_security_posture();
    for posture in security_posture.checks.into_iter().filter(|item| item.status == "warning") {
      findings.push(LocalFinding {
        id: Uuid::new_v4().to_string(),
        category: format!("security_posture:{}", posture.category),
        severity: posture.severity,
        title: posture.title,
        summary: posture.summary,
        evidence: posture.evidence,
        remediation: posture.remediation,
      });
    }

    if denied > 0 {
      findings.push(LocalFinding {
        id: Uuid::new_v4().to_string(),
        category: "permissions".to_string(),
        severity: "info".to_string(),
        title: "Some locations could not be read".to_string(),
        summary: format!("{} filesystem entries were inaccessible with the current operating-system permissions.", denied),
        evidence: "Operating-system permission boundary".to_string(),
        remediation: "Use the CashPatch Permission Center to decide whether broader read-only access is appropriate. Do not bypass OS security controls.".to_string(),
      });
    }

    if ai_failures > 0 {
      warnings.push(format!("Local AI analysis failed for {ai_failures} documents. These are not clean results; retry after checking the local model."));
    }
    if ai_truncated > 0 {
      warnings.push(format!("{ai_truncated} documents exceeded the AI input window; only their first approximately 12,000 characters were reviewed."));
    }
    if local_ai_documents_reviewed >= MAX_LOCAL_AI_DOCUMENTS_PER_SCAN {
      warnings.push("The 2,500-document AI safety limit was reached. Later documents may not have received AI review.".to_string());
    }
    if let Ok(mut state) = runtime().lock() {
      state.snapshot.phase = "completed".to_string();
      state.snapshot.current_item = None;
      state.snapshot.files_seen = files;
      state.snapshot.directories_seen = dirs;
      state.snapshot.bytes_seen = bytes;
      state.snapshot.permission_denied = denied;
      state.snapshot.findings_count = findings.len() as u64;
      state.snapshot.progress_percent = 100.0;
      state.snapshot.elapsed_seconds = started.elapsed().as_secs();
      state.snapshot.eta_seconds = Some(0);
      state.snapshot.findings = findings;
      state.snapshot.coverage_warnings = warnings;
      state.snapshot.ai_documents_reviewed = local_ai_documents_reviewed.saturating_sub(ai_failures);
      state.snapshot.paused = false;
    }
    emit_snapshot(&app);
  });

  Ok(())
}

#[tauri::command]
pub fn scan_pause() -> Result<(), String> {
  let mut state = runtime().lock().map_err(|_| "Scan state is unavailable")?;
  if state.snapshot.phase != "full_scanning" && state.snapshot.phase != "quick_scanning" {
    return Err("No active scan can be paused".to_string());
  }
  state.pause.store(true, Ordering::Relaxed);
  state.snapshot.paused = true;
  Ok(())
}

#[tauri::command]
pub fn scan_resume() -> Result<(), String> {
  let mut state = runtime().lock().map_err(|_| "Scan state is unavailable")?;
  if !state.snapshot.paused {
    return Err("Scan is not paused".to_string());
  }
  state.pause.store(false, Ordering::Relaxed);
  state.snapshot.paused = false;
  Ok(())
}

#[tauri::command]
pub fn scan_cancel() -> Result<(), String> {
  let mut state = runtime().lock().map_err(|_| "Scan state is unavailable")?;
  if state.snapshot.phase != "full_scanning" && state.snapshot.phase != "quick_scanning" {
    return Err("No active scan can be cancelled".to_string());
  }
  state.cancel.store(true, Ordering::Relaxed);
  state.snapshot.cancelled = true;
  Ok(())
}

#[tauri::command]
pub fn scan_discard_recovery() -> Result<(), String> {
  scan_journal::discard_recovery()
}

#[tauri::command]
pub fn scan_clear_history() -> Result<(), String> {
  scan_journal::clear_history()
}

#[tauri::command]
pub fn scan_export_report(path: String, format: String) -> Result<(), String> {
  let destination = PathBuf::from(path);
  if destination.as_os_str().is_empty() {
    return Err("Report destination is required".to_string());
  }

  let snapshot = runtime()
    .lock()
    .map_err(|_| "Scan state is unavailable".to_string())?
    .snapshot
    .clone();

  if snapshot.phase != "completed" {
    return Err("A completed Full Scan is required before report export".to_string());
  }

  let body = match format.as_str() {
    "json" => serde_json::to_string_pretty(&snapshot).map_err(|e| e.to_string())?,
    "markdown" => {
      let mut lines = Vec::<String>::new();
      lines.push("# CashPatch Local Audit Report".to_string());
      lines.push(String::new());
      lines.push("Review-only report. CashPatch did not execute any remediation or external change.".to_string());
      lines.push(String::new());
      lines.push(format!("- Scan ID: {}", snapshot.scan_id.clone().unwrap_or_default()));
      lines.push(format!("- Files reviewed: {}", snapshot.files_seen));
      lines.push(format!("- Data mapped: {} bytes", snapshot.bytes_seen));
      lines.push(format!("- Permission boundaries: {}", snapshot.permission_denied));
      lines.push(format!("- Findings: {}", snapshot.findings_count));
      lines.push(format!("- Documents successfully reviewed by local AI: {}", snapshot.ai_documents_reviewed));
      lines.push(String::new());
      lines.push("## Coverage limitations".to_string());
      for warning in &snapshot.coverage_warnings {
        lines.push(format!("- {warning}"));
      }
      lines.push(format!("- Duration: {} seconds", snapshot.elapsed_seconds));
      lines.push(String::new());
      lines.push("## Findings".to_string());
      lines.push(String::new());

      if snapshot.findings.is_empty() {
        lines.push("No findings were produced by this scan pass.".to_string());
      } else {
        for (index, finding) in snapshot.findings.iter().enumerate() {
          lines.push(format!("### {}. {}", index + 1, finding.title));
          lines.push(String::new());
          lines.push(format!("- Category: {}", finding.category));
          lines.push(format!("- Severity: {}", finding.severity));
          lines.push(format!("- Confidence: {}%", finding_confidence(finding)));
          lines.push(format!("- Possible financial impact: {}", finding_financial_impact(finding)));
          lines.push(format!("- Evidence: {}", finding.evidence));
          lines.push(String::new());
          lines.push(finding.summary.clone());
          lines.push(String::new());
          lines.push(format!("**Recommended human action:** {}", finding.remediation));
          lines.push(String::new());
        }
      }

      lines.join("\n")
    }
    _ => return Err("Unsupported report format".to_string()),
  };

  if let Some(parent) = destination.parent() {
    if !parent.as_os_str().is_empty() {
      std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
  }

  std::fs::write(destination, body).map_err(|e| e.to_string())
}

#[cfg(test)]
mod scope_tests {
  use super::*;

  #[test]
  fn selected_scope_never_adds_default_roots_and_deduplicates_nested_paths() {
    let root = std::env::temp_dir().join(format!("cashpatch-scope-{}", Uuid::new_v4()));
    std::fs::create_dir_all(root.join("nested")).unwrap();
    let result = resolve_roots(vec![root.display().to_string(), root.join("nested").display().to_string()]).unwrap();
    assert_eq!(result, vec![root.canonicalize().unwrap()]);
    std::fs::remove_dir_all(root).unwrap();
  }

  #[test]
  fn missing_explicit_scope_fails_instead_of_scanning_home() {
    let missing = std::env::temp_dir().join(format!("cashpatch-missing-{}", Uuid::new_v4()));
    assert!(resolve_roots(vec![missing.display().to_string()]).is_err());
  }
}
