use std::{
    env,
    fs,
    path::PathBuf,
    process::Command,
};

fn command_output(command: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(command).args(args).output().ok()?;

    if !output.status.success() {
        return None;
    }

    String::from_utf8(output.stdout)
        .ok()
        .map(|value| value.trim().to_string())
}

fn sidecar_path(manifest_directory: &PathBuf) -> Option<PathBuf> {
    let target_triple = command_output("rustc", &["--print", "host-tuple"])?;
    let extension = if cfg!(target_os = "windows") { ".exe" } else { "" };

    Some(
        manifest_directory
            .join("binaries")
            .join(format!("engineering-os-node-{target_triple}{extension}")),
    )
}

fn ensure_node_sidecar(manifest_directory: &PathBuf) {
    let Some(sidecar_path) = sidecar_path(manifest_directory) else {
        return;
    };

    if sidecar_path.exists() {
        return;
    }

    let Some(node_binary) = command_output("node", &["-p", "process.execPath"]) else {
        return;
    };

    let node_binary_path = PathBuf::from(node_binary);

    if let Some(parent_directory) = sidecar_path.parent() {
        let _ = fs::create_dir_all(parent_directory);
    }

    let _ = fs::copy(node_binary_path, &sidecar_path);

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let _ = fs::set_permissions(&sidecar_path, fs::Permissions::from_mode(0o755));
    }
}

fn ensure_backend_bundle(manifest_directory: &PathBuf) {
    let backend_bundle_path = manifest_directory.join("../desktop-backend/dist/server.js");

    if backend_bundle_path.exists() {
        return;
    }

    let build_script_path = manifest_directory.join("../../../scripts/build-desktop-backend.mjs");

    let _ = Command::new("node")
        .arg(build_script_path)
        .current_dir(manifest_directory)
        .status();
}

fn main() {
    let manifest_directory = PathBuf::from(
        env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR should be set for build.rs"),
    );
    ensure_node_sidecar(&manifest_directory);
    ensure_backend_bundle(&manifest_directory);
    tauri_build::build()
}
