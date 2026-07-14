use crate::{
    error::{command_error, CommandResult},
    paths::{application_data_dir, backend_entry_path},
};
use std::{env, sync::Mutex};
use tauri_plugin_shell::{process::CommandChild, ShellExt};

const BACKEND_HOST: &str = "127.0.0.1";
const BACKEND_PORT: u16 = 43_110;
const NODE_SIDECAR_NAME: &str = "engineering-os-node";

fn backend_host() -> String {
    env::var("EOS_DESKTOP_BACKEND_HOST")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| BACKEND_HOST.to_string())
}

fn backend_port() -> u16 {
    env::var("EOS_DESKTOP_BACKEND_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port > 0)
        .unwrap_or(BACKEND_PORT)
}

#[derive(Default)]
pub struct BackendHostState {
    child: Mutex<Option<CommandChild>>,
}

pub fn backend_base_url() -> String {
    format!("http://{}:{}", backend_host(), backend_port())
}

pub fn initialize_backend_host(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, BackendHostState>,
) -> CommandResult<()> {
    if cfg!(debug_assertions) {
        return Ok(());
    }

    let mut current_child = state
        .child
        .lock()
        .map_err(|_| command_error("BACKEND_HOST_LOCK_FAILED", "Failed to acquire backend host state."))?;

    if current_child.is_some() {
        return Ok(());
    }

    let entry_path = backend_entry_path(app)?;
    let app_data_directory = application_data_dir(app)?;
    let backend_host = backend_host();
    let backend_port = backend_port();
    let sidecar_command = app
        .shell()
        .sidecar(NODE_SIDECAR_NAME)
        .map_err(|error| command_error("BACKEND_SIDECAR_UNAVAILABLE", error.to_string()))?
        .args([entry_path.display().to_string()])
        .env("EOS_APPLICATION_DATA_DIR", app_data_directory.display().to_string())
        .env("EOS_DESKTOP_BACKEND_HOST", backend_host)
        .env("EOS_DESKTOP_BACKEND_PORT", backend_port.to_string());
    let (_receiver, child) = sidecar_command
        .spawn()
        .map_err(|error| command_error("BACKEND_SIDECAR_SPAWN_FAILED", error.to_string()))?;

    *current_child = Some(child);

    Ok(())
}

pub fn terminate_backend_host(state: &tauri::State<'_, BackendHostState>) {
    let Ok(mut current_child) = state.child.lock() else {
        return;
    };

    if let Some(child) = current_child.take() {
        let _ = child.kill();
    }
}
