use crate::error::CommandResult;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    operating_system: &'static str,
    family: &'static str,
    arch: &'static str,
    app_data_directory: String,
    is_development: bool,
}

#[tauri::command]
pub fn get_app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub fn get_platform_info(app: tauri::AppHandle) -> CommandResult<PlatformInfo> {
    Ok(PlatformInfo {
        operating_system: std::env::consts::OS,
        family: std::env::consts::FAMILY,
        arch: std::env::consts::ARCH,
        app_data_directory: crate::paths::application_data_dir(&app)?
            .display()
            .to_string(),
        is_development: cfg!(debug_assertions),
    })
}
