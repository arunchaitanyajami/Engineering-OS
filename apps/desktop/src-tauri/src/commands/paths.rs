use crate::error::CommandResult;

#[tauri::command]
pub fn get_application_data_directory(app: tauri::AppHandle) -> CommandResult<String> {
    Ok(crate::paths::application_data_dir(&app)?
        .display()
        .to_string())
}

#[tauri::command]
pub fn get_backend_base_url() -> String {
    crate::backend_host::backend_base_url()
}
