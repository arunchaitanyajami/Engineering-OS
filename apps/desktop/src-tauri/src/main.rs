#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backend_host;
mod commands;
mod error;
mod paths;

use backend_host::{initialize_backend_host, terminate_backend_host, BackendHostState};
use tauri::Manager;

fn main() {
    let application = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(BackendHostState::default())
        .setup(|app| {
            let state = app.state::<BackendHostState>();
            initialize_backend_host(app.handle(), &state)
                .map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info::get_app_version,
            commands::app_info::get_platform_info,
            commands::paths::get_application_data_directory,
            commands::paths::get_backend_connection,
            commands::external_url::open_external_url
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Engineering OS desktop shell");

    application.run(|app_handle, event| {
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            let state = app_handle.state::<BackendHostState>();
            terminate_backend_host(&state);
        }
    });
}
