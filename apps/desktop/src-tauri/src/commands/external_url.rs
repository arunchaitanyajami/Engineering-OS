use crate::error::{command_error, CommandResult};
use url::Url;

fn validate_external_url(url: &str) -> CommandResult<()> {
    let parsed =
        Url::parse(url).map_err(|error| command_error("INVALID_EXTERNAL_URL", error.to_string()))?;

    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err(command_error(
            "INVALID_EXTERNAL_URL",
            "Only http and https URLs are allowed.",
        ));
    }

    if parsed.host_str().is_none() {
        return Err(command_error(
            "INVALID_EXTERNAL_URL",
            "External URLs must include a host.",
        ));
    }

    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(command_error(
            "INVALID_EXTERNAL_URL",
            "Embedded credentials are not allowed in external URLs.",
        ));
    }

    Ok(())
}

#[tauri::command]
pub fn open_external_url(url: String) -> CommandResult<()> {
    validate_external_url(&url)?;

    webbrowser::open(&url)
        .map_err(|error| command_error("EXTERNAL_URL_OPEN_FAILED", error.to_string()))?;

    Ok(())
}
