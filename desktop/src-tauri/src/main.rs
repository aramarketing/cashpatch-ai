#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod inventory;

fn main() {
  let _ = inventory::collect_system_inventory();
  cashpatch_desktop_lib::run();
}
