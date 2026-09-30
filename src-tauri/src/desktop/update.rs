//! "Update available" check against GitHub Releases.
//!
//! The .deb and .rpm builds cannot use Tauri's self-updater (it only replaces
//! AppImages and needs a signing key), so the app reports a newer release and
//! links to its download page instead.

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};

const LATEST_RELEASE_URL: &str = "https://api.github.com/repos/coderaulia/vanailachat/releases/latest";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    pub latest: String,
    pub available: bool,
    pub url: String,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
}

/// Parses `v1.2.3` / `1.2.3` (ignoring any `-suffix`) into comparable parts.
fn parse_version(value: &str) -> Option<(u64, u64, u64)> {
    let core = value.trim().trim_start_matches('v').split(['-', '+']).next()?;
    let mut parts = core.split('.').map(|part| part.parse::<u64>().ok());
    Some((parts.next()??, parts.next().flatten().unwrap_or(0), parts.next().flatten().unwrap_or(0)))
}

pub fn is_newer(latest: &str, current: &str) -> bool {
    match (parse_version(latest), parse_version(current)) {
        (Some(latest), Some(current)) => latest > current,
        _ => false,
    }
}

pub async fn check_for_update(current: &str) -> AppResult<UpdateInfo> {
    let release: Release = reqwest::Client::new()
        .get(LATEST_RELEASE_URL)
        .header("User-Agent", format!("vanaila-chat/{current}"))
        .header("Accept", "application/vnd.github+json")
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(AppError::Network)?
        .error_for_status()
        .map_err(AppError::Network)?
        .json()
        .await
        .map_err(AppError::Network)?;

    let latest = release.tag_name.trim_start_matches('v').to_string();
    Ok(UpdateInfo {
        available: !release.draft && !release.prerelease && is_newer(&latest, current),
        current: current.to_string(),
        latest,
        url: release.html_url,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_semver_numerically() {
        assert!(is_newer("0.3.10", "0.3.2"));
        assert!(is_newer("v1.0.0", "0.9.9"));
        assert!(!is_newer("0.3.2", "0.3.2"));
        assert!(!is_newer("0.3.1", "0.3.2"));
        assert!(!is_newer("0.4.0-beta.1", "0.4.0"));
        assert!(!is_newer("not-a-version", "0.3.2"));
    }
}
