use serde::{Deserialize, Serialize};
use std::{env, fs, path::PathBuf};
use uuid::Uuid;

#[derive(Clone, Deserialize, Serialize)]
pub(super) struct SavedServer {
    pub(super) address: String,
    pub(super) name: String,
}

#[derive(Default, Deserialize, Serialize)]
pub(super) struct Preferences {
    #[serde(default)]
    pub(super) language: Option<String>,
    #[serde(default)]
    pub(super) servers: Vec<SavedServer>,
}

impl Preferences {
    pub(super) fn load() -> Self {
        path()
            .and_then(|path| fs::read(path).ok())
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    pub(super) fn remember(&mut self, address: String, name: String) {
        self.servers.retain(|server| server.address != address);
        self.servers.insert(0, SavedServer { address, name });
        self.save();
    }

    pub(super) fn save(&self) {
        let Some(path) = path() else { return };
        let Some(directory) = path.parent() else {
            return;
        };
        let Ok(contents) = serde_json::to_vec(self) else {
            return;
        };
        if fs::create_dir_all(directory).is_err() {
            return;
        }
        let temporary = directory.join(format!("preferences-{}.tmp", Uuid::new_v4()));
        if fs::write(&temporary, contents).is_ok() && fs::rename(&temporary, path).is_err() {
            let _ = fs::remove_file(temporary);
        }
    }
}

fn path() -> Option<PathBuf> {
    let base = if cfg!(target_os = "windows") {
        env::var_os("LOCALAPPDATA").map(PathBuf::from)
    } else {
        env::var_os("XDG_STATE_HOME")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/state")))
    }?;
    Some(base.join("Yapper").join("preferences.json"))
}
