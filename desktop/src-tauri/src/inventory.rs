use serde::Serialize;
use std::{collections::BTreeSet, fs, path::PathBuf};
use sysinfo::{Disks, Networks, System};

const MAX_PROCESS_NAMES: usize = 250;
const MAX_APP_NAMES: usize = 500;
const MAX_AUTOSTART_ENTRIES: usize = 250;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskInventory {
  pub name: String,
  pub mount_point: String,
  pub total_bytes: u64,
  pub available_bytes: u64,
  pub removable: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInterfaceInventory {
  pub name: String,
  pub received_bytes: u64,
  pub transmitted_bytes: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSoftwareInventory {
  pub name: String,
  pub version: Option<String>,
  pub publisher: Option<String>,
  pub install_path: Option<String>,
  pub source: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInventory {
  pub os_name: String,
  pub os_version: String,
  pub kernel_version: String,
  pub architecture: String,
  pub host_name: String,
  pub cpu_brand: String,
  pub logical_cpu_count: usize,
  pub total_memory_bytes: u64,
  pub available_memory_bytes: u64,
  pub uptime_seconds: u64,
  pub process_count: usize,
  pub running_processes: Vec<String>,
  pub disks: Vec<DiskInventory>,
  pub network_interfaces: Vec<NetworkInterfaceInventory>,
  pub installed_apps: Vec<String>,
  pub installed_software: Vec<InstalledSoftwareInventory>,
  pub autostart_entries: Vec<String>,
}

fn list_directory_names(paths: &[PathBuf], max_entries: usize) -> Vec<String> {
  let mut names = BTreeSet::<String>::new();

  for root in paths {
    let Ok(entries) = fs::read_dir(root) else {
      continue;
    };

    for entry in entries.flatten() {
      if names.len() >= max_entries {
        break;
      }
      let name = entry.file_name().to_string_lossy().trim().to_string();
      if !name.is_empty() {
        names.insert(name);
      }
    }
  }

  names.into_iter().take(max_entries).collect()
}

fn installed_app_roots() -> Vec<PathBuf> {
  let mut roots = Vec::<PathBuf>::new();

  #[cfg(target_os = "macos")]
  {
    roots.push(PathBuf::from("/Applications"));
    roots.push(PathBuf::from("/System/Applications"));
    if let Some(home) = std::env::var_os("HOME") {
      roots.push(PathBuf::from(home).join("Applications"));
    }
  }

  #[cfg(target_os = "windows")]
  {
    for key in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
      if let Some(value) = std::env::var_os(key) {
        let path = PathBuf::from(value);
        if key == "LOCALAPPDATA" {
          roots.push(path.join("Programs"));
        } else {
          roots.push(path);
        }
      }
    }
  }

  roots
}

fn autostart_roots() -> Vec<PathBuf> {
  let mut roots = Vec::<PathBuf>::new();

  #[cfg(target_os = "macos")]
  {
    roots.push(PathBuf::from("/Library/LaunchAgents"));
    roots.push(PathBuf::from("/Library/LaunchDaemons"));
    if let Some(home) = std::env::var_os("HOME") {
      roots.push(PathBuf::from(home).join("Library/LaunchAgents"));
    }
  }

  #[cfg(target_os = "windows")]
  {
    if let Some(appdata) = std::env::var_os("APPDATA") {
      roots.push(
        PathBuf::from(appdata)
          .join("Microsoft/Windows/Start Menu/Programs/Startup"),
      );
    }
    if let Some(program_data) = std::env::var_os("ProgramData") {
      roots.push(
        PathBuf::from(program_data)
          .join("Microsoft/Windows/Start Menu/Programs/StartUp"),
      );
    }
  }

  roots
}

#[cfg(target_os = "macos")]
fn collect_installed_software() -> Vec<InstalledSoftwareInventory> {
  let mut software = Vec::<InstalledSoftwareInventory>::new();
  let mut seen = BTreeSet::<String>::new();

  for root in installed_app_roots() {
    let Ok(entries) = fs::read_dir(root) else {
      continue;
    };

    for entry in entries.flatten() {
      if software.len() >= MAX_APP_NAMES {
        break;
      }

      let path = entry.path();
      if path.extension().and_then(|v| v.to_str()) != Some("app") {
        continue;
      }

      let fallback_name = path
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or("Unknown application")
        .trim()
        .to_string();
      let info_path = path.join("Contents/Info.plist");

      let mut name = fallback_name;
      let mut version = None;
      let mut publisher = None;

      if let Ok(value) = plist::Value::from_file(&info_path) {
        if let Some(dict) = value.as_dictionary() {
          if let Some(value) = dict
            .get("CFBundleDisplayName")
            .and_then(|value| value.as_string())
            .or_else(|| dict.get("CFBundleName").and_then(|value| value.as_string()))
          {
            let candidate = value.trim();
            if !candidate.is_empty() {
              name = candidate.to_string();
            }
          }

          version = dict
            .get("CFBundleShortVersionString")
            .and_then(|value| value.as_string())
            .or_else(|| dict.get("CFBundleVersion").and_then(|value| value.as_string()))
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());

          publisher = dict
            .get("CFBundleIdentifier")
            .and_then(|value| value.as_string())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        }
      }

      let key = format!("{}|{}", name.to_ascii_lowercase(), version.clone().unwrap_or_default());
      if !seen.insert(key) {
        continue;
      }

      software.push(InstalledSoftwareInventory {
        name,
        version,
        publisher,
        install_path: Some(path.display().to_string()),
        source: "macos_bundle".to_string(),
      });
    }
  }

  software.sort_by(|a, b| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()));
  software.truncate(MAX_APP_NAMES);
  software
}

#[cfg(target_os = "windows")]
fn collect_windows_uninstall_key(
  root: winreg::enums::HKEY,
  path: &str,
  software: &mut Vec<InstalledSoftwareInventory>,
  seen: &mut BTreeSet<String>,
) {
  use winreg::{enums::KEY_READ, RegKey};

  let hive = RegKey::predef(root);
  let Ok(uninstall) = hive.open_subkey_with_flags(path, KEY_READ) else {
    return;
  };

  for subkey_name in uninstall.enum_keys().flatten() {
    if software.len() >= MAX_APP_NAMES {
      break;
    }
    let Ok(entry) = uninstall.open_subkey_with_flags(&subkey_name, KEY_READ) else {
      continue;
    };

    let name: String = entry.get_value("DisplayName").unwrap_or_default();
    let name = name.trim().to_string();
    if name.is_empty() {
      continue;
    }

    let version = entry
      .get_value::<String, _>("DisplayVersion")
      .ok()
      .map(|value| value.trim().to_string())
      .filter(|value| !value.is_empty());
    let publisher = entry
      .get_value::<String, _>("Publisher")
      .ok()
      .map(|value| value.trim().to_string())
      .filter(|value| !value.is_empty());
    let install_path = entry
      .get_value::<String, _>("InstallLocation")
      .ok()
      .map(|value| value.trim().to_string())
      .filter(|value| !value.is_empty());

    let key = format!("{}|{}", name.to_ascii_lowercase(), version.clone().unwrap_or_default());
    if !seen.insert(key) {
      continue;
    }

    software.push(InstalledSoftwareInventory {
      name,
      version,
      publisher,
      install_path,
      source: "windows_uninstall_registry".to_string(),
    });
  }
}

#[cfg(target_os = "windows")]
fn collect_installed_software() -> Vec<InstalledSoftwareInventory> {
  use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

  let mut software = Vec::<InstalledSoftwareInventory>::new();
  let mut seen = BTreeSet::<String>::new();
  let keys = [
    (HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
    (HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
    (HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
  ];

  for (root, path) in keys {
    collect_windows_uninstall_key(root, path, &mut software, &mut seen);
  }

  software.sort_by(|a, b| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()));
  software.truncate(MAX_APP_NAMES);
  software
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn collect_installed_software() -> Vec<InstalledSoftwareInventory> {
  Vec::new()
}

pub fn collect_system_inventory() -> SystemInventory {
  let mut system = System::new_all();
  system.refresh_all();

  let cpu_brand = system
    .cpus()
    .first()
    .map(|cpu| cpu.brand().trim().to_string())
    .unwrap_or_default();

  let mut running_processes = system
    .processes()
    .values()
    .map(|process| process.name().to_string_lossy().trim().to_string())
    .filter(|name| !name.is_empty())
    .collect::<BTreeSet<_>>()
    .into_iter()
    .take(MAX_PROCESS_NAMES)
    .collect::<Vec<_>>();
  running_processes.sort();

  let disks = Disks::new_with_refreshed_list()
    .list()
    .iter()
    .map(|disk| DiskInventory {
      name: disk.name().to_string_lossy().to_string(),
      mount_point: disk.mount_point().display().to_string(),
      total_bytes: disk.total_space(),
      available_bytes: disk.available_space(),
      removable: disk.is_removable(),
    })
    .collect::<Vec<_>>();

  let networks = Networks::new_with_refreshed_list();
  let mut network_interfaces = (&networks)
    .into_iter()
    .map(|(name, data)| NetworkInterfaceInventory {
      name: name.to_string(),
      received_bytes: data.total_received(),
      transmitted_bytes: data.total_transmitted(),
    })
    .collect::<Vec<_>>();
  network_interfaces.sort_by(|a, b| a.name.cmp(&b.name));

  let installed_software = collect_installed_software();

  SystemInventory {
    os_name: System::name().unwrap_or_else(|| std::env::consts::OS.to_string()),
    os_version: System::os_version().unwrap_or_default(),
    kernel_version: System::kernel_version().unwrap_or_default(),
    architecture: std::env::consts::ARCH.to_string(),
    host_name: System::host_name().unwrap_or_default(),
    cpu_brand,
    logical_cpu_count: system.cpus().len(),
    total_memory_bytes: system.total_memory(),
    available_memory_bytes: system.available_memory(),
    uptime_seconds: System::uptime(),
    process_count: system.processes().len(),
    running_processes,
    disks,
    network_interfaces,
    installed_apps: list_directory_names(&installed_app_roots(), MAX_APP_NAMES),
    installed_software,
    autostart_entries: list_directory_names(&autostart_roots(), MAX_AUTOSTART_ENTRIES),
  }
}

#[tauri::command]
pub fn system_inventory() -> SystemInventory {
  collect_system_inventory()
}
