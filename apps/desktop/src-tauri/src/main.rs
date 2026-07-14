#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};
use tauri::Manager;

const CONFIG_FILE_NAME: &str = "application-config.json";
const DATABASE_FILE_NAME: &str = "engineering-os.sqlite";
const LOG_DIRECTORY_NAME: &str = "logs";
const LOG_FILE_NAME: &str = "application.log";

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DatabaseStatus {
    ok: bool,
    migration_version: i64,
    database_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalServicesStatus {
    database: DatabaseStatus,
    log_file_path: String,
    config_file_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EngineeringSession {
    id: String,
    title: String,
    created_at: String,
    updated_at: String,
    status: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedLogEntry {
    timestamp: String,
    level: String,
    scope: String,
    message: String,
    context: Option<serde_json::Value>,
    correlation_id: Option<String>,
}

type CommandResult<T> = Result<T, CommandError>;

fn map_io_error(code: &'static str, error: std::io::Error) -> CommandError {
    CommandError {
        code,
        message: error.to_string(),
    }
}

fn map_sql_error(code: &'static str, error: rusqlite::Error) -> CommandError {
    CommandError {
        code,
        message: error.to_string(),
    }
}

fn ensure_directory(path: &Path) -> CommandResult<()> {
    fs::create_dir_all(path).map_err(|error| map_io_error("DIRECTORY_CREATE_FAILED", error))
}

fn application_data_dir(app: &tauri::AppHandle) -> CommandResult<PathBuf> {
    let directory = app.path().app_data_dir().map_err(|error| CommandError {
        code: "APP_DATA_DIR_UNAVAILABLE",
        message: error.to_string(),
    })?;
    ensure_directory(&directory)?;
    Ok(directory)
}

fn config_file_path(app: &tauri::AppHandle) -> CommandResult<PathBuf> {
    Ok(application_data_dir(app)?.join(CONFIG_FILE_NAME))
}

fn database_file_path(app: &tauri::AppHandle) -> CommandResult<PathBuf> {
    Ok(application_data_dir(app)?.join(DATABASE_FILE_NAME))
}

fn log_file_path(app: &tauri::AppHandle) -> CommandResult<PathBuf> {
    let log_directory = application_data_dir(app)?.join(LOG_DIRECTORY_NAME);
    ensure_directory(&log_directory)?;
    Ok(log_directory.join(LOG_FILE_NAME))
}

fn open_database_connection(app: &tauri::AppHandle) -> CommandResult<Connection> {
    let path = database_file_path(app)?;
    let connection =
        Connection::open(path).map_err(|error| map_sql_error("DATABASE_OPEN_FAILED", error))?;

    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|error| map_sql_error("DATABASE_PRAGMA_FAILED", error))?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| map_sql_error("DATABASE_PRAGMA_FAILED", error))?;

    Ok(connection)
}

fn apply_migration(
    connection: &Connection,
    version: i64,
    sql: &str,
) -> Result<(), rusqlite::Error> {
    let already_applied = connection.query_row(
        "SELECT COUNT(*) FROM schema_migrations WHERE version = ?1",
        [version],
        |row| row.get::<_, i64>(0),
    )?;

    if already_applied > 0 {
        return Ok(());
    }

    let transaction = connection.unchecked_transaction()?;
    transaction.execute_batch(sql)?;
    transaction.execute(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, CURRENT_TIMESTAMP)",
        [version],
    )?;
    transaction.commit()?;

    Ok(())
}

fn run_migrations(connection: &Connection) -> CommandResult<i64> {
    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS schema_migrations (
              version INTEGER PRIMARY KEY,
              applied_at TEXT NOT NULL
            );
            ",
        )
        .map_err(|error| map_sql_error("MIGRATION_BOOTSTRAP_FAILED", error))?;

    apply_migration(
        connection,
        1,
        "
        CREATE TABLE IF NOT EXISTS application_metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        ",
    )
    .map_err(|error| map_sql_error("MIGRATION_APPLY_FAILED", error))?;

    apply_migration(
        connection,
        2,
        "
        CREATE TABLE IF NOT EXISTS engineering_sessions (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          status TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_engineering_sessions_updated_at
          ON engineering_sessions(updated_at DESC);
        ",
    )
    .map_err(|error| map_sql_error("MIGRATION_APPLY_FAILED", error))?;

    connection
        .execute(
            "
            INSERT INTO application_metadata (key, value, updated_at)
            VALUES ('database_status', 'ready', CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET
              value = excluded.value,
              updated_at = excluded.updated_at
            ",
            [],
        )
        .map_err(|error| map_sql_error("METADATA_WRITE_FAILED", error))?;

    connection
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| map_sql_error("MIGRATION_READ_FAILED", error))
}

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

fn validate_serialized_config(serialized_config: &str) -> CommandResult<()> {
    if serialized_config.len() > 128 * 1024 {
        return Err(CommandError {
            code: "CONFIG_TOO_LARGE",
            message: "Application configuration exceeds the allowed size.".to_string(),
        });
    }

    serde_json::from_str::<serde_json::Value>(serialized_config).map_err(|error| CommandError {
        code: "CONFIG_INVALID_JSON",
        message: error.to_string(),
    })?;

    Ok(())
}

fn validate_session(session: &EngineeringSession) -> CommandResult<()> {
    if session.id.trim().is_empty() || session.id.len() > 128 {
        return Err(CommandError {
            code: "SESSION_ID_INVALID",
            message: "Session id must be present and shorter than 128 characters.".to_string(),
        });
    }

    if session.title.trim().is_empty() || session.title.len() > 200 {
        return Err(CommandError {
            code: "SESSION_TITLE_INVALID",
            message: "Session title must be present and shorter than 200 characters.".to_string(),
        });
    }

    if session.status != "active" && session.status != "archived" {
        return Err(CommandError {
            code: "SESSION_STATUS_INVALID",
            message: "Session status must be active or archived.".to_string(),
        });
    }

    Ok(())
}

fn validate_log_entry(entry: &PersistedLogEntry) -> CommandResult<()> {
    let valid_levels = ["trace", "debug", "info", "warn", "error"];

    if !valid_levels.contains(&entry.level.as_str()) {
        return Err(CommandError {
            code: "LOG_LEVEL_INVALID",
            message: "Log level is not supported.".to_string(),
        });
    }

    if entry.scope.trim().is_empty() || entry.message.trim().is_empty() {
        return Err(CommandError {
            code: "LOG_ENTRY_INVALID",
            message: "Log scope and message are required.".to_string(),
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
    application_data_dir(&app).map(|path| path.display().to_string())
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
fn initialize_local_services(app: tauri::AppHandle) -> CommandResult<LocalServicesStatus> {
    let config_path = config_file_path(&app)?;
    let log_path = log_file_path(&app)?;
    let connection = open_database_connection(&app)?;
    let migration_version = run_migrations(&connection)?;
    let database_path = database_file_path(&app)?;

    Ok(LocalServicesStatus {
        database: DatabaseStatus {
            ok: true,
            migration_version,
            database_path: database_path.display().to_string(),
        },
        log_file_path: log_path.display().to_string(),
        config_file_path: config_path.display().to_string(),
    })
}

#[tauri::command]
fn load_persisted_config(app: tauri::AppHandle) -> CommandResult<Option<String>> {
    let path = config_file_path(&app)?;

    if !path.exists() {
        return Ok(None);
    }

    fs::read_to_string(path)
        .map(Some)
        .map_err(|error| map_io_error("CONFIG_READ_FAILED", error))
}

#[tauri::command]
fn save_persisted_config(app: tauri::AppHandle, serialized_config: String) -> CommandResult<()> {
    validate_serialized_config(&serialized_config)?;
    let path = config_file_path(&app)?;
    fs::write(path, serialized_config).map_err(|error| map_io_error("CONFIG_WRITE_FAILED", error))
}

#[tauri::command]
fn list_sessions(app: tauri::AppHandle) -> CommandResult<Vec<EngineeringSession>> {
    let connection = open_database_connection(&app)?;
    run_migrations(&connection)?;
    let mut statement = connection
        .prepare(
            "
            SELECT id, title, created_at, updated_at, status
            FROM engineering_sessions
            ORDER BY updated_at DESC
            ",
        )
        .map_err(|error| map_sql_error("SESSION_QUERY_FAILED", error))?;

    let rows = statement
        .query_map([], |row| {
            Ok(EngineeringSession {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
                status: row.get(4)?,
            })
        })
        .map_err(|error| map_sql_error("SESSION_QUERY_FAILED", error))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| map_sql_error("SESSION_QUERY_FAILED", error))
}

#[tauri::command]
fn create_session(app: tauri::AppHandle, session: EngineeringSession) -> CommandResult<EngineeringSession> {
    validate_session(&session)?;
    let connection = open_database_connection(&app)?;
    run_migrations(&connection)?;
    connection
        .execute(
            "
            INSERT INTO engineering_sessions (id, title, created_at, updated_at, status)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ",
            params![
                session.id,
                session.title,
                session.created_at,
                session.updated_at,
                session.status
            ],
        )
        .map_err(|error| map_sql_error("SESSION_CREATE_FAILED", error))?;

    Ok(session)
}

#[tauri::command]
fn write_log_entry(app: tauri::AppHandle, entry: PersistedLogEntry) -> CommandResult<()> {
    validate_log_entry(&entry)?;
    let path = log_file_path(&app)?;
    let serialized_entry = serde_json::to_string(&entry).map_err(|error| CommandError {
        code: "LOG_SERIALIZATION_FAILED",
        message: error.to_string(),
    })?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| map_io_error("LOG_WRITE_FAILED", error))?;
    writeln!(file, "{serialized_entry}").map_err(|error| map_io_error("LOG_WRITE_FAILED", error))
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
            initialize_local_services,
            load_persisted_config,
            save_persisted_config,
            list_sessions,
            create_session,
            write_log_entry,
            open_external_url
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Engineering OS desktop shell");
}
