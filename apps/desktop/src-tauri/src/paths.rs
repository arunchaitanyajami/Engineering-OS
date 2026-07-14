use crate::error::{command_error, CommandResult};
use std::{fs, path::PathBuf};
use tauri::Manager;

pub const BACKEND_ENTRY_RESOURCE_PATH: &str = "desktop-backend/server.js";

pub fn ensure_directory(path: &PathBuf) -> CommandResult<()> {
    fs::create_dir_all(path)
        .map_err(|error| command_error("DIRECTORY_CREATE_FAILED", error.to_string()))
}

pub fn application_data_dir(app: &tauri::AppHandle) -> CommandResult<PathBuf> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| command_error("APP_DATA_DIR_UNAVAILABLE", error.to_string()))?;

    ensure_directory(&directory)?;

    Ok(directory)
}

pub fn backend_entry_path(app: &tauri::AppHandle) -> CommandResult<PathBuf> {
    let resource_directory = app
        .path()
        .resource_dir()
        .map_err(|error| command_error("RESOURCE_DIR_UNAVAILABLE", error.to_string()))?;

    Ok(resource_directory.join(BACKEND_ENTRY_RESOURCE_PATH))
}
