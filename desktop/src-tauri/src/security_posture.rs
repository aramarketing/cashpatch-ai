use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityPostureCheck {
  pub id: String,
  pub category: String,
  pub title: String,
  pub status: String,
  pub severity: String,
  pub confidence: u8,
  pub summary: String,
  pub evidence: String,
  pub remediation: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityPostureReport {
  pub platform: String,
  pub checks: Vec<SecurityPostureCheck>,
  pub passed: u64,
  pub warnings: u64,
  pub unknown: u64,
}

fn check(
  id: &str,
  category: &str,
  title: &str,
  status: &str,
  severity: &str,
  confidence: u8,
  summary: &str,
  evidence: &str,
  remediation: &str,
) -> SecurityPostureCheck {
  SecurityPostureCheck {
    id: id.to_string(),
    category: category.to_string(),
    title: title.to_string(),
    status: status.to_string(),
    severity: severity.to_string(),
    confidence,
    summary: summary.to_string(),
    evidence: evidence.to_string(),
    remediation: remediation.to_string(),
  }
}

#[cfg(target_os = "macos")]
fn read_plist(path: &str) -> Option<plist::Dictionary> {
  match plist::Value::from_file(path).ok()? {
    plist::Value::Dictionary(dictionary) => Some(dictionary),
    _ => None,
  }
}

#[cfg(target_os = "macos")]
fn macos_checks() -> Vec<SecurityPostureCheck> {
  let mut checks = Vec::new();

  let firewall = read_plist("/Library/Preferences/com.apple.alf.plist")
    .and_then(|dictionary| dictionary.get("globalstate").and_then(|value| value.as_signed_integer()));
  checks.push(match firewall {
    Some(0) => check(
      "macos-firewall",
      "network",
      "macOS application firewall",
      "warning",
      "medium",
      95,
      "The macOS application firewall appears to be disabled.",
      "Read-only check of the system firewall preference reported globalstate=0.",
      "Review System Settings > Network > Firewall and enable it if your environment does not require it to be off. CashPatch will not change this setting.",
    ),
    Some(1 | 2) => check(
      "macos-firewall",
      "network",
      "macOS application firewall",
      "pass",
      "info",
      95,
      "The macOS application firewall appears to be enabled.",
      "Read-only system firewall preference indicates an enabled state.",
      "No action is required unless your security policy requires stricter firewall rules.",
    ),
    _ => check(
      "macos-firewall",
      "network",
      "macOS application firewall",
      "unknown",
      "info",
      45,
      "CashPatch could not determine the firewall state from the readable system preference.",
      "The firewall preference was absent, inaccessible or used an unrecognized state.",
      "Verify the firewall state manually in System Settings. CashPatch does not bypass macOS permissions.",
    ),
  });

  let login = read_plist("/Library/Preferences/com.apple.loginwindow.plist");
  let auto_login = login
    .as_ref()
    .and_then(|dictionary| dictionary.get("autoLoginUser"))
    .and_then(|value| value.as_string())
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .is_some();
  checks.push(if auto_login {
    check(
      "macos-auto-login",
      "authentication",
      "Automatic login",
      "warning",
      "high",
      90,
      "Automatic login appears to be configured for a local macOS account.",
      "A non-empty autoLoginUser preference was found. The account name was intentionally not collected.",
      "Disable automatic login unless it is explicitly required and physically secured. CashPatch will not change the login configuration.",
    )
  } else {
    check(
      "macos-auto-login",
      "authentication",
      "Automatic login",
      "pass",
      "info",
      80,
      "No automatic-login user was found in the readable login-window preference.",
      "No non-empty autoLoginUser value was observed.",
      "No action is required based on this check.",
    )
  });

  let guest_enabled = login
    .as_ref()
    .and_then(|dictionary| dictionary.get("GuestEnabled"))
    .and_then(|value| value.as_boolean());
  checks.push(match guest_enabled {
    Some(true) => check(
      "macos-guest-account",
      "authentication",
      "Guest account",
      "warning",
      "low",
      85,
      "The macOS guest account appears to be enabled.",
      "The readable login-window preference reports GuestEnabled=true.",
      "Review whether guest access is needed. Disable it manually if it is not part of your intended security policy.",
    ),
    Some(false) => check(
      "macos-guest-account",
      "authentication",
      "Guest account",
      "pass",
      "info",
      85,
      "The macOS guest account appears to be disabled.",
      "The readable login-window preference reports GuestEnabled=false.",
      "No action is required based on this check.",
    ),
    None => check(
      "macos-guest-account",
      "authentication",
      "Guest account",
      "unknown",
      "info",
      40,
      "CashPatch could not determine the guest-account state from readable preferences.",
      "The GuestEnabled preference was not available.",
      "Verify the guest-account setting manually if it matters to your security policy.",
    ),
  });

  let screensaver = std::env::var_os("HOME")
    .map(std::path::PathBuf::from)
    .and_then(|home| {
      let path = home.join("Library/Preferences/com.apple.screensaver.plist");
      match plist::Value::from_file(path).ok()? {
        plist::Value::Dictionary(dictionary) => Some(dictionary),
        _ => None,
      }
    });
  let ask_for_password = screensaver
    .as_ref()
    .and_then(|dictionary| dictionary.get("askForPassword"))
    .and_then(|value| value.as_boolean());
  let password_delay = screensaver
    .as_ref()
    .and_then(|dictionary| dictionary.get("askForPasswordDelay"))
    .and_then(|value| value.as_signed_integer());
  checks.push(match (ask_for_password, password_delay) {
    (Some(true), Some(delay)) if delay <= 300 => check(
      "macos-screen-lock",
      "authentication",
      "Screen-lock password",
      "pass",
      "info",
      75,
      "The readable screen-saver preference requires a password with a short delay.",
      "askForPassword=true and the configured delay is five minutes or less.",
      "No action is required unless your organization requires an immediate lock.",
    ),
    (Some(false), _) => check(
      "macos-screen-lock",
      "authentication",
      "Screen-lock password",
      "warning",
      "high",
      80,
      "The readable screen-saver preference indicates that a password is not required after the screen saver starts.",
      "askForPassword=false was observed in the current user's readable preference.",
      "Enable password requirement after sleep or screen saver in System Settings. CashPatch will not modify the setting.",
    ),
    (Some(true), Some(delay)) if delay > 300 => check(
      "macos-screen-lock",
      "authentication",
      "Screen-lock password",
      "warning",
      "medium",
      70,
      "A screen-lock password is enabled, but the readable delay is longer than five minutes.",
      "askForPassword=true with a delay greater than 300 seconds.",
      "Consider shortening the password delay manually if this Mac contains sensitive business data.",
    ),
    _ => check(
      "macos-screen-lock",
      "authentication",
      "Screen-lock password",
      "unknown",
      "info",
      35,
      "Modern macOS versions may store this policy outside the legacy readable preference, so CashPatch will not guess.",
      "No reliable readable askForPassword value was available.",
      "Verify Lock Screen password timing manually in System Settings if required.",
    ),
  });

  checks
}

#[cfg(target_os = "windows")]
fn read_hklm_dword(path: &str, name: &str) -> Option<u32> {
  use winreg::{enums::{HKEY_LOCAL_MACHINE, KEY_READ}, RegKey};
  RegKey::predef(HKEY_LOCAL_MACHINE)
    .open_subkey_with_flags(path, KEY_READ)
    .ok()?
    .get_value::<u32, _>(name)
    .ok()
}

#[cfg(target_os = "windows")]
fn read_hklm_string(path: &str, name: &str) -> Option<String> {
  use winreg::{enums::{HKEY_LOCAL_MACHINE, KEY_READ}, RegKey};
  RegKey::predef(HKEY_LOCAL_MACHINE)
    .open_subkey_with_flags(path, KEY_READ)
    .ok()?
    .get_value::<String, _>(name)
    .ok()
}

#[cfg(target_os = "windows")]
fn windows_firewall_check(profile: &str, key: &str) -> SecurityPostureCheck {
  let path = format!(r"SYSTEM\CurrentControlSet\Services\SharedAccess\Parameters\FirewallPolicy\{key}");
  match read_hklm_dword(&path, "EnableFirewall") {
    Some(0) => check(
      &format!("windows-firewall-{}", profile.to_ascii_lowercase()),
      "network",
      &format!("Windows Firewall · {profile}"),
      "warning",
      "high",
      95,
      &format!("Windows Firewall appears to be disabled for the {profile} profile."),
      "A read-only registry check reported EnableFirewall=0.",
      "Review Windows Security > Firewall & network protection and enable the profile if it is not intentionally managed another way.",
    ),
    Some(_) => check(
      &format!("windows-firewall-{}", profile.to_ascii_lowercase()),
      "network",
      &format!("Windows Firewall · {profile}"),
      "pass",
      "info",
      95,
      &format!("Windows Firewall appears to be enabled for the {profile} profile."),
      "A read-only registry check reports the firewall profile enabled.",
      "No action is required based on this check.",
    ),
    None => check(
      &format!("windows-firewall-{}", profile.to_ascii_lowercase()),
      "network",
      &format!("Windows Firewall · {profile}"),
      "unknown",
      "info",
      40,
      "CashPatch could not determine this firewall profile from the readable registry policy.",
      "The expected EnableFirewall value was unavailable.",
      "Verify the profile manually in Windows Security if required.",
    ),
  }
}

#[cfg(target_os = "windows")]
fn windows_checks() -> Vec<SecurityPostureCheck> {
  let mut checks = vec![
    windows_firewall_check("Domain", "DomainProfile"),
    windows_firewall_check("Private", "StandardProfile"),
    windows_firewall_check("Public", "PublicProfile"),
  ];

  checks.push(match read_hklm_dword(
    r"SOFTWARE\Microsoft\Windows Defender\Real-Time Protection",
    "DisableRealtimeMonitoring",
  ) {
    Some(1) => check(
      "windows-defender-realtime",
      "endpoint_protection",
      "Microsoft Defender real-time protection",
      "warning",
      "high",
      85,
      "A readable Defender policy indicates that real-time monitoring is disabled.",
      "DisableRealtimeMonitoring=1 was observed. CashPatch did not inspect antivirus content or history.",
      "Review Windows Security or your managed endpoint-protection policy. Re-enable protection manually if it is not intentionally managed by another security product.",
    ),
    Some(0) => check(
      "windows-defender-realtime",
      "endpoint_protection",
      "Microsoft Defender real-time protection",
      "pass",
      "info",
      85,
      "The readable Defender policy does not disable real-time monitoring.",
      "DisableRealtimeMonitoring=0 was observed.",
      "No action is required based on this policy check.",
    ),
    _ => check(
      "windows-defender-realtime",
      "endpoint_protection",
      "Microsoft Defender real-time protection",
      "unknown",
      "info",
      35,
      "CashPatch could not determine Defender real-time state from the readable policy registry.",
      "The DisableRealtimeMonitoring policy was unavailable or managed elsewhere.",
      "Verify endpoint protection manually in Windows Security or your managed-security console.",
    ),
  });

  checks.push(match read_hklm_dword(
    r"SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System",
    "EnableLUA",
  ) {
    Some(0) => check(
      "windows-uac",
      "privilege",
      "User Account Control",
      "warning",
      "high",
      95,
      "User Account Control appears to be disabled.",
      "EnableLUA=0 was observed in a read-only registry check.",
      "Enable UAC manually unless a documented managed environment requires otherwise.",
    ),
    Some(_) => check(
      "windows-uac",
      "privilege",
      "User Account Control",
      "pass",
      "info",
      95,
      "User Account Control appears to be enabled.",
      "EnableLUA is enabled in the readable system policy.",
      "No action is required based on this check.",
    ),
    None => check(
      "windows-uac",
      "privilege",
      "User Account Control",
      "unknown",
      "info",
      40,
      "CashPatch could not determine UAC state from the readable system policy.",
      "EnableLUA was unavailable.",
      "Verify UAC manually if required.",
    ),
  });

  let auto_admin_logon = read_hklm_string(
    r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon",
    "AutoAdminLogon",
  )
  .map(|value| value.trim() == "1")
  .unwrap_or(false);
  checks.push(if auto_admin_logon {
    check(
      "windows-auto-logon",
      "authentication",
      "Automatic Windows logon",
      "warning",
      "high",
      90,
      "Windows automatic logon appears to be enabled.",
      "AutoAdminLogon=1 was observed. CashPatch intentionally did not read any stored username or password value.",
      "Disable automatic logon unless it is explicitly required and the device is physically secured.",
    )
  } else {
    check(
      "windows-auto-logon",
      "authentication",
      "Automatic Windows logon",
      "pass",
      "info",
      75,
      "Windows automatic logon was not observed as enabled.",
      "AutoAdminLogon was absent or not set to 1. No credential values were read.",
      "No action is required based on this check.",
    )
  });

  checks.push(match read_hklm_dword(
    r"SYSTEM\CurrentControlSet\Services\LanmanServer\Parameters",
    "SMB1",
  ) {
    Some(1) => check(
      "windows-smb1",
      "network",
      "SMBv1 server protocol",
      "warning",
      "high",
      90,
      "The legacy SMBv1 server protocol appears to be explicitly enabled.",
      "SMB1=1 was observed in the server service registry parameters.",
      "Review whether SMBv1 is still required. Disable it manually after confirming no legacy dependency relies on it.",
    ),
    Some(0) => check(
      "windows-smb1",
      "network",
      "SMBv1 server protocol",
      "pass",
      "info",
      90,
      "The legacy SMBv1 server protocol appears to be explicitly disabled.",
      "SMB1=0 was observed.",
      "No action is required based on this check.",
    ),
    _ => check(
      "windows-smb1",
      "network",
      "SMBv1 server protocol",
      "unknown",
      "info",
      45,
      "No explicit SMB1 server registry value was available, so CashPatch will not infer the effective feature state.",
      "The SMB1 value was absent or inaccessible.",
      "Verify the optional-feature state manually if legacy SMB exposure is relevant to your environment.",
    ),
  });

  checks
}

pub fn collect_security_posture() -> SecurityPostureReport {
  #[cfg(target_os = "macos")]
  let checks = macos_checks();

  #[cfg(target_os = "windows")]
  let checks = windows_checks();

  #[cfg(not(any(target_os = "macos", target_os = "windows")))]
  let checks = vec![check(
    "unsupported-platform",
    "platform",
    "Security posture",
    "unknown",
    "info",
    100,
    "Security posture checks are currently implemented for macOS and Windows only.",
    "Unsupported desktop platform.",
    "Run CashPatch on a supported macOS or Windows device.",
  )];

  let passed = checks.iter().filter(|item| item.status == "pass").count() as u64;
  let warnings = checks.iter().filter(|item| item.status == "warning").count() as u64;
  let unknown = checks.iter().filter(|item| item.status == "unknown").count() as u64;

  SecurityPostureReport {
    platform: std::env::consts::OS.to_string(),
    checks,
    passed,
    warnings,
    unknown,
  }
}

#[tauri::command]
pub fn security_posture_scan() -> SecurityPostureReport {
  collect_security_posture()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn report_counts_match_check_statuses() {
    let report = collect_security_posture();
    assert_eq!(
      report.passed + report.warnings + report.unknown,
      report
        .checks
        .iter()
        .filter(|item| matches!(item.status.as_str(), "pass" | "warning" | "unknown"))
        .count() as u64
    );
  }

  #[test]
  fn checks_never_offer_automatic_remediation() {
    let report = collect_security_posture();
    for item in report.checks {
      let remediation = item.remediation.to_ascii_lowercase();
      assert!(!remediation.contains("cashpatch will enable"));
      assert!(!remediation.contains("cashpatch will disable"));
      assert!(!remediation.contains("cashpatch changed"));
    }
  }
}
