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
    autostart_entries: list_directory_names(&autostart_roots(), MAX_AUTOSTART_ENTRIES),
  }
}

#[tauri::command]
pub fn system_inventory() -> SystemInventory {
  collect_system_inventory()
}
