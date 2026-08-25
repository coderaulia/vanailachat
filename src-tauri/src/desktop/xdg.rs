use std::fs;
use std::path::PathBuf;
use dirs;

#[derive(Debug, Clone)]
pub struct DesktopPaths {
    pub config_dir: PathBuf,
    pub data_dir: PathBuf,
    pub cache_dir: PathBuf,
}

impl DesktopPaths {
    pub fn new() -> Self {
        let app_id = "vanaila-chat";
        Self {
            config_dir: dirs::config_dir()
                .unwrap_or_else(|| PathBuf::from("~/.config"))
                .join(app_id),
            data_dir: dirs::data_dir()
                .unwrap_or_else(|| PathBuf::from("~/.local/share"))
                .join(app_id),
            cache_dir: dirs::cache_dir()
                .unwrap_or_else(|| PathBuf::from("~/.cache"))
                .join(app_id),
        }
    }

    pub fn ensure_directories(&self) -> std::io::Result<()> {
        fs::create_dir_all(&self.config_dir)?;
        fs::create_dir_all(&self.data_dir)?;
        fs::create_dir_all(&self.cache_dir)?;
        Ok(())
    }

    pub fn database_file(&self) -> PathBuf {
        self.data_dir.join("vanaila.sqlite")
    }
}
