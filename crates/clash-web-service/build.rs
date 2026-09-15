fn main() {
    println!("cargo:rerun-if-env-changed=CLASH_WEB_VERSION");
    if let Ok(version) = std::env::var("CLASH_WEB_VERSION") {
        println!("cargo:rustc-env=CLASH_WEB_VERSION={version}");
    }
}
