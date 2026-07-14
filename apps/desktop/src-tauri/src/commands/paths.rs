use crate::{
    backend_host::BackendConnectionInfo,
    error::{command_error, CommandResult},
};
use tauri::Manager;

#[tauri::command]
pub fn get_application_data_directory(app: tauri::AppHandle) -> CommandResult<String> {
    Ok(crate::paths::application_data_dir(&app)?
        .display()
        .to_string())
}

#[tauri::command]
pub fn get_backend_connection(
    app: tauri::AppHandle,
) -> CommandResult<BackendConnectionInfo> {
    let state = app
        .try_state::<crate::backend_host::BackendHostState>()
        .ok_or_else(|| {
            command_error(
                "BACKEND_HOST_STATE_MISSING",
                "Desktop backend host state is unavailable.",
            )
        })?;

    crate::backend_host::backend_connection(&state)
}
