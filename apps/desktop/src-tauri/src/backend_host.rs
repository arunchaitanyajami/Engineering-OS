use crate::{
    error::{command_error, CommandResult},
    paths::{application_data_dir, backend_entry_path},
};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use std::{
    env,
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    sync::{mpsc::RecvTimeoutError, Mutex},
    time::{Duration, Instant},
};
use tauri::async_runtime::Receiver;
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

const BACKEND_HOST: &str = "127.0.0.1";
const NODE_SIDECAR_NAME: &str = "engineering-os-node";
const READY_MESSAGE_PREFIX: &str = "ENGINEERING_OS_BACKEND_READY ";
const BACKEND_READY_TIMEOUT: Duration = Duration::from_secs(15);
const BACKEND_HEALTH_TIMEOUT: Duration = Duration::from_secs(10);
const BACKEND_HEALTH_RETRY_DELAY: Duration = Duration::from_millis(150);

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
        .unwrap_or(0)
}

fn backend_auth_token() -> CommandResult<String> {
    env::var("EOS_DESKTOP_BACKEND_AUTH_TOKEN")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            command_error(
                "BACKEND_AUTH_TOKEN_MISSING",
                "Desktop backend auth token is missing.",
            )
        })
}

fn backend_allowed_origin() -> Option<String> {
    env::var("EOS_DESKTOP_ALLOWED_ORIGIN")
        .ok()
        .filter(|value| !value.trim().is_empty())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendConnectionInfo {
    pub base_url: String,
    pub authorization_token: String,
}

struct ManagedBackendRuntime {
    child: Option<CommandChild>,
    connection: BackendConnectionInfo,
}

#[derive(Default)]
pub struct BackendHostState {
    runtime: Mutex<Option<ManagedBackendRuntime>>,
}

#[derive(Deserialize)]
struct ReadyPayload {
    host: Option<String>,
    port: u16,
}

fn generate_auth_token() -> String {
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn create_connection(host: String, port: u16, authorization_token: String) -> BackendConnectionInfo {
    BackendConnectionInfo {
        base_url: format!("http://{}:{}", host, port),
        authorization_token,
    }
}

fn parse_ready_payload(line: &[u8]) -> CommandResult<ReadyPayload> {
    let message = String::from_utf8_lossy(line).trim().to_string();
    let payload = message.strip_prefix(READY_MESSAGE_PREFIX).ok_or_else(|| {
        command_error(
            "BACKEND_READY_MESSAGE_INVALID",
            "Desktop backend did not report a valid ready message.",
        )
    })?;

    serde_json::from_str::<ReadyPayload>(payload).map_err(|error| {
        command_error(
            "BACKEND_READY_MESSAGE_INVALID",
            format!("Desktop backend ready message is invalid: {error}"),
        )
    })
}

fn receive_ready_payload(mut receiver: Receiver<CommandEvent>) -> CommandResult<ReadyPayload> {
    let (event_sender, event_receiver) = std::sync::mpsc::channel();

    tauri::async_runtime::spawn(async move {
        while let Some(event) = receiver.recv().await {
            if event_sender.send(event).is_err() {
                break;
            }
        }
    });

    let deadline = Instant::now() + BACKEND_READY_TIMEOUT;
    let mut last_error: Option<String> = None;

    loop {
        let now = Instant::now();
        if now >= deadline {
            return Err(command_error(
                "BACKEND_READY_TIMEOUT",
                last_error.unwrap_or_else(|| {
                    "Timed out while waiting for the desktop backend ready signal.".to_string()
                }),
            ));
        }

        let remaining = deadline.saturating_duration_since(now);
        match event_receiver.recv_timeout(remaining) {
            Ok(CommandEvent::Stdout(line)) => {
                let message = String::from_utf8_lossy(&line).trim().to_string();
                if message.starts_with(READY_MESSAGE_PREFIX) {
                    return parse_ready_payload(&line);
                }
            }
            Ok(CommandEvent::Stderr(line)) => {
                last_error = Some(String::from_utf8_lossy(&line).trim().to_string());
            }
            Ok(CommandEvent::Error(message)) => {
                return Err(command_error(
                    "BACKEND_SIDECAR_ERROR",
                    format!("Desktop backend sidecar reported an error: {message}"),
                ));
            }
            Ok(CommandEvent::Terminated(payload)) => {
                return Err(command_error(
                    "BACKEND_SIDECAR_TERMINATED",
                    format!(
                        "Desktop backend sidecar terminated before readiness (code: {:?}, signal: {:?}).",
                        payload.code, payload.signal
                    ),
                ));
            }
            Ok(_) => {}
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => {
                return Err(command_error(
                    "BACKEND_READY_CHANNEL_CLOSED",
                    "Desktop backend readiness channel closed unexpectedly.",
                ));
            }
        }
    }
}

fn check_backend_health(connection: &BackendConnectionInfo) -> Result<(), String> {
    let backend_url = url::Url::parse(&connection.base_url)
        .map_err(|error| format!("Invalid backend URL: {error}"))?;
    let host = backend_url
        .host_str()
        .ok_or_else(|| "Backend URL is missing a host.".to_string())?;
    let port = backend_url
        .port_or_known_default()
        .ok_or_else(|| "Backend URL is missing a port.".to_string())?;
    let mut addresses = (host, port)
        .to_socket_addrs()
        .map_err(|error| format!("Failed to resolve backend address: {error}"))?;
    let address = addresses
        .next()
        .ok_or_else(|| "Failed to resolve a socket address for the backend.".to_string())?;
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(500))
        .map_err(|error| format!("Failed to connect to backend: {error}"))?;

    stream
        .set_read_timeout(Some(Duration::from_millis(500)))
        .map_err(|error| format!("Failed to set backend read timeout: {error}"))?;
    stream
        .set_write_timeout(Some(Duration::from_millis(500)))
        .map_err(|error| format!("Failed to set backend write timeout: {error}"))?;

    let request = format!(
        "GET /health HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\nAuthorization: Bearer {}\r\n\r\n",
        connection.authorization_token
    );

    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("Failed to write backend health request: {error}"))?;

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| format!("Failed to read backend health response: {error}"))?;

    if response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200") {
        Ok(())
    } else {
        Err(format!(
            "Backend health request returned an unexpected response: {}",
            response.lines().next().unwrap_or("empty response")
        ))
    }
}

fn wait_for_backend_ready(connection: &BackendConnectionInfo) -> CommandResult<()> {
    let deadline = Instant::now() + BACKEND_HEALTH_TIMEOUT;
    let last_error = loop {
        match check_backend_health(connection) {
            Ok(()) => return Ok(()),
            Err(error) => {
                if Instant::now() >= deadline {
                    break error;
                }
            }
        }

        std::thread::sleep(BACKEND_HEALTH_RETRY_DELAY);
    };

    Err(command_error("BACKEND_HEALTH_TIMEOUT", last_error))
}

pub fn backend_connection(
    state: &tauri::State<'_, BackendHostState>,
) -> CommandResult<BackendConnectionInfo> {
    let runtime = state.runtime.lock().map_err(|_| {
        command_error(
            "BACKEND_HOST_LOCK_FAILED",
            "Failed to acquire backend host state.",
        )
    })?;

    runtime
        .as_ref()
        .map(|runtime| runtime.connection.clone())
        .ok_or_else(|| {
            command_error(
                "BACKEND_CONNECTION_UNAVAILABLE",
                "Desktop backend connection is not available.",
            )
        })
}

pub fn initialize_backend_host(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, BackendHostState>,
) -> CommandResult<()> {
    let mut current_runtime = state
        .runtime
        .lock()
        .map_err(|_| command_error("BACKEND_HOST_LOCK_FAILED", "Failed to acquire backend host state."))?;

    if current_runtime.is_some() {
        return Ok(());
    }

    if cfg!(debug_assertions) {
        let connection = create_connection(backend_host(), backend_port(), backend_auth_token()?);
        wait_for_backend_ready(&connection)?;
        *current_runtime = Some(ManagedBackendRuntime {
            child: None,
            connection,
        });
        return Ok(());
    }

    let entry_path = backend_entry_path(app)?;
    let app_data_directory = application_data_dir(app)?;
    let resolved_backend_host = backend_host();
    let backend_port = backend_port();
    let backend_auth_token = generate_auth_token();
    let sidecar_command = app
        .shell()
        .sidecar(NODE_SIDECAR_NAME)
        .map_err(|error| command_error("BACKEND_SIDECAR_UNAVAILABLE", error.to_string()))?
        .args([entry_path.display().to_string()])
        .env("EOS_APPLICATION_DATA_DIR", app_data_directory.display().to_string())
        .env("EOS_DESKTOP_BACKEND_HOST", &resolved_backend_host)
        .env("EOS_DESKTOP_BACKEND_PORT", backend_port.to_string())
        .env("EOS_DESKTOP_BACKEND_AUTH_TOKEN", &backend_auth_token)
        .envs(
            backend_allowed_origin()
                .map(|origin| vec![("EOS_DESKTOP_ALLOWED_ORIGIN", origin)])
                .unwrap_or_default(),
        );
    let (receiver, child) = sidecar_command
        .spawn()
        .map_err(|error| command_error("BACKEND_SIDECAR_SPAWN_FAILED", error.to_string()))?;
    let ready_payload = match receive_ready_payload(receiver) {
        Ok(payload) => payload,
        Err(error) => {
            let _ = child.kill();
            return Err(error);
        }
    };
    let connection = create_connection(
        ready_payload
            .host
            .unwrap_or_else(|| resolved_backend_host.clone()),
        ready_payload.port,
        backend_auth_token,
    );

    if let Err(error) = wait_for_backend_ready(&connection) {
        let _ = child.kill();
        return Err(error);
    }

    *current_runtime = Some(ManagedBackendRuntime {
        child: Some(child),
        connection,
    });

    Ok(())
}

pub fn terminate_backend_host(state: &tauri::State<'_, BackendHostState>) {
    let Ok(mut current_runtime) = state.runtime.lock() else {
        return;
    };

    if let Some(runtime) = current_runtime.take() {
        if let Some(child) = runtime.child {
            let _ = child.kill();
        }
    }
}
