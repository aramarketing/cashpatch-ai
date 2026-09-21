fn main() {
  println!("cargo:rerun-if-env-changed=CASHPATCH_ADHOC_TEST_BUILD");
  tauri_build::build()
}
