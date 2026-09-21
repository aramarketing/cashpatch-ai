#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod conversations;
mod inventory;

fn main() {
  cashpatch_desktop_lib::run();
}
