#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use tauri::Manager;

#[derive(Debug, Serialize)]
struct CommandError {
    code: &'static str,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlatformInfo {
    operating_system: &'static str,
    family: &'static str,
    arch: &'static str,
    app_data_directory: String,
    is_development: bool,
}

type CommandResult<T> = Result<T, CommandError>;

fn validate_external_url(url: &str) -> CommandResult<()> {
    let trimmed = url.trim();

    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err(CommandError {
            code: "INVALID_EXTERNAL_URL",
            message: "Only http and https URLs are allowed.".to_string(),
        });
    }

    Ok(())
}

#[tauri::command]
fn get_app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
fn get_application_data_directory(app: tauri::AppHandle) -> CommandResult<String> {
    app.path()
        .app_data_dir()
        .map(|path| path.display().to_string())
        .map_err(|error| CommandError {
            code: "APP_DATA_DIR_UNAVAILABLE",
            message: error.to_string(),
        })
}

#[tauri::command]
fn get_platform_info(app: tauri::AppHandle) -> CommandResult<PlatformInfo> {
    Ok(PlatformInfo {
        operating_system: std::env::consts::OS,
        family: std::env::consts::FAMILY,
        arch: std::env::consts::ARCH,
        app_data_directory: get_application_data_directory(app.clone())?,
        is_development: cfg!(debug_assertions),
    })
}

#[tauri::command]
fn open_external_url(url: String) -> CommandResult<()> {
    validate_external_url(&url)?;

    webbrowser::open(&url).map_err(|error| CommandError {
        code: "EXTERNAL_URL_OPEN_FAILED",
        message: error.to_string(),
    })?;

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            get_application_data_directory,
            get_platform_info,
            open_external_url
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Engineering OS desktop shell");
}
