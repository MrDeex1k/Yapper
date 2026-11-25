use std::{
    collections::{BTreeMap, HashSet},
    env, fmt, fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Shortcut {
    Focus,
    Open,
    ScrollUp,
    ScrollDown,
    Microphone,
    Older,
    Leave,
    Refresh,
    Language,
    Server,
    Quit,
}

impl Shortcut {
    pub const ALL: [Self; 11] = [
        Self::Focus,
        Self::Open,
        Self::ScrollUp,
        Self::ScrollDown,
        Self::Microphone,
        Self::Older,
        Self::Leave,
        Self::Refresh,
        Self::Language,
        Self::Server,
        Self::Quit,
    ];

    fn default_key(self) -> Binding {
        match self {
            Self::Focus => Binding::Tab,
            Self::Open => Binding::Enter,
            Self::ScrollUp => Binding::PageUp,
            Self::ScrollDown => Binding::PageDown,
            Self::Microphone => Binding::Function(5),
            Self::Older => Binding::Function(6),
            Self::Leave => Binding::Function(7),
            Self::Refresh => Binding::Function(8),
            Self::Language => Binding::Function(1),
            Self::Server => Binding::Function(4),
            Self::Quit => Binding::Ctrl('c'),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Binding {
    Tab,
    Enter,
    PageUp,
    PageDown,
    Function(u8),
    Ctrl(char),
    Alt(char),
}

impl Binding {
    pub fn from_event(key: KeyEvent) -> Option<Self> {
        match (key.code, key.modifiers) {
            (KeyCode::Tab | KeyCode::BackTab, KeyModifiers::NONE)
            | (KeyCode::BackTab, KeyModifiers::SHIFT) => Some(Self::Tab),
            (KeyCode::Enter, KeyModifiers::NONE) => Some(Self::Enter),
            (KeyCode::PageUp, KeyModifiers::NONE) => Some(Self::PageUp),
            (KeyCode::PageDown, KeyModifiers::NONE) => Some(Self::PageDown),
            (KeyCode::F(number), KeyModifiers::NONE) => Some(Self::Function(number)),
            (KeyCode::Char(ch), KeyModifiers::CONTROL) => Some(Self::Ctrl(ch.to_ascii_lowercase())),
            (KeyCode::Char(ch), KeyModifiers::ALT) => Some(Self::Alt(ch.to_ascii_lowercase())),
            _ => None,
        }
    }

    fn allowed_for(self, action: Shortcut) -> bool {
        match self {
            Self::Function(number) => (1..=12).contains(&number) && number != 2,
            Self::Ctrl('c') => action == Shortcut::Quit,
            // Many terminals emit the same byte for these combinations and editing keys.
            Self::Ctrl(ch) => ch.is_ascii_lowercase() && !matches!(ch, 'h' | 'i' | 'j' | 'm' | 'u'),
            Self::Alt(ch) => ch.is_ascii_lowercase(),
            _ => true,
        }
    }
}

impl fmt::Display for Binding {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Tab => formatter.write_str("Tab"),
            Self::Enter => formatter.write_str("Enter"),
            Self::PageUp => formatter.write_str("PgUp"),
            Self::PageDown => formatter.write_str("PgDn"),
            Self::Function(number) => write!(formatter, "F{number}"),
            Self::Ctrl(ch) => write!(formatter, "Ctrl+{}", ch.to_ascii_uppercase()),
            Self::Alt(ch) => write!(formatter, "Alt+{}", ch.to_ascii_uppercase()),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Problem {
    Load,
    Save,
    Unsupported,
    Conflict(Shortcut),
    Saved,
}

pub(crate) struct Shortcuts {
    path: Option<PathBuf>,
    overrides: BTreeMap<Shortcut, Binding>,
    pub startup_notice: Option<Problem>,
}

impl Shortcuts {
    pub fn load() -> Self {
        Self::at(config_dir().map(|dir| dir.join("yapper-terminal").join("shortcuts.json")))
    }

    fn at(path: Option<PathBuf>) -> Self {
        let loaded = path.as_deref().map_or_else(
            || Err(io::Error::other("no user configuration directory")),
            load_file,
        );
        let (overrides, startup_notice) = match loaded {
            Ok(overrides) => (overrides, None),
            Err(error) if error.kind() == io::ErrorKind::NotFound => (BTreeMap::new(), None),
            Err(_) => (BTreeMap::new(), Some(Problem::Load)),
        };
        Self {
            path,
            overrides,
            startup_notice,
        }
    }

    pub fn key(&self, action: Shortcut) -> Binding {
        key(&self.overrides, action)
    }

    pub fn action(&self, event: KeyEvent) -> Option<Shortcut> {
        let binding = Binding::from_event(event)?;
        Shortcut::ALL
            .into_iter()
            .find(|&action| self.key(action) == binding)
    }

    pub fn assign(&mut self, action: Shortcut, key: Binding) -> Result<(), Problem> {
        if !key.allowed_for(action) {
            return Err(Problem::Unsupported);
        }
        if let Some(other) = Shortcut::ALL
            .into_iter()
            .find(|&other| other != action && self.key(other) == key)
        {
            return Err(Problem::Conflict(other));
        }
        let mut next = self.overrides.clone();
        if key == action.default_key() {
            next.remove(&action);
        } else {
            next.insert(action, key);
        }
        self.save(next)
    }

    pub fn reset(&mut self) -> Result<(), Problem> {
        self.save(BTreeMap::new())
    }

    fn save(&mut self, next: BTreeMap<Shortcut, Binding>) -> Result<(), Problem> {
        let path = self.path.as_deref().ok_or(Problem::Save)?;
        save_file(path, &next).map_err(|_| Problem::Save)?;
        self.overrides = next;
        self.startup_notice = None;
        Ok(())
    }
}

fn key(overrides: &BTreeMap<Shortcut, Binding>, action: Shortcut) -> Binding {
    overrides
        .get(&action)
        .copied()
        .unwrap_or_else(|| action.default_key())
}

fn load_file(path: &Path) -> io::Result<BTreeMap<Shortcut, Binding>> {
    const MAX_BYTES: u64 = 16_384;
    let mut contents = Vec::new();
    fs::File::open(path)?
        .take(MAX_BYTES + 1)
        .read_to_end(&mut contents)?;
    if contents.len() as u64 > MAX_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "shortcut preferences exceed size limit",
        ));
    }
    let overrides = serde_json::from_slice(&contents)?;
    let mut seen = HashSet::new();
    for action in Shortcut::ALL {
        let binding = key(&overrides, action);
        if !binding.allowed_for(action) || !seen.insert(binding) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "invalid shortcut preferences",
            ));
        }
    }
    Ok(overrides)
}

fn save_file(path: &Path, overrides: &BTreeMap<Shortcut, Binding>) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("missing settings directory"))?;
    fs::create_dir_all(parent)?;
    let mut file = tempfile::NamedTempFile::new_in(parent)?;
    serde_json::to_writer_pretty(&mut file, overrides)?;
    file.write_all(b"\n")?;
    file.as_file().sync_all()?;
    file.persist(path)?;
    Ok(())
}

fn config_dir() -> Option<PathBuf> {
    let absolute = |name| {
        env::var_os(name)
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
    };
    #[cfg(target_os = "windows")]
    return absolute("APPDATA");

    #[cfg(target_os = "macos")]
    return absolute("HOME").map(|home| home.join("Library").join("Application Support"));

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    absolute("XDG_CONFIG_HOME").or_else(|| absolute("HOME").map(|home| home.join(".config")))
}

#[cfg(test)]
mod tests {
    use super::{Binding, Problem, Shortcut, Shortcuts};
    use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

    #[test]
    fn rebound_key_survives_reload_and_reset() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("profile").join("shortcuts.json");
        let mut shortcuts = Shortcuts::at(Some(path.clone()));
        assert_eq!(
            shortcuts.assign(Shortcut::Microphone, Binding::Function(9)),
            Ok(())
        );
        let mut reloaded = Shortcuts::at(Some(path.clone()));
        let event = |number| KeyEvent::new(KeyCode::F(number), KeyModifiers::NONE);
        assert_eq!(reloaded.action(event(9)), Some(Shortcut::Microphone));
        assert_eq!(reloaded.action(event(5)), None);
        reloaded.reset().unwrap();
        assert_eq!(
            Shortcuts::at(Some(path)).action(event(5)),
            Some(Shortcut::Microphone)
        );
    }

    #[test]
    fn invalid_assignments_and_failed_saves_preserve_bindings() {
        let mut shortcuts = Shortcuts::at(None);
        assert_eq!(
            shortcuts.assign(Shortcut::Microphone, Binding::Function(6)),
            Err(Problem::Conflict(Shortcut::Older))
        );
        assert_eq!(
            shortcuts.assign(Shortcut::Microphone, Binding::Function(2)),
            Err(Problem::Unsupported)
        );
        assert_eq!(
            shortcuts.assign(Shortcut::Microphone, Binding::Function(9)),
            Err(Problem::Save)
        );
        assert_eq!(shortcuts.key(Shortcut::Microphone), Binding::Function(5));
    }

    #[test]
    fn corrupt_or_conflicting_preferences_use_defaults() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("shortcuts.json");
        for contents in [b"{".as_slice(), br#"{"microphone":{"function":6}}"#] {
            std::fs::write(&path, contents).unwrap();
            let shortcuts = Shortcuts::at(Some(path.clone()));
            assert_eq!(shortcuts.startup_notice, Some(Problem::Load));
            assert_eq!(shortcuts.key(Shortcut::Microphone), Binding::Function(5));
            assert_eq!(std::fs::read(&path).unwrap(), contents);
        }
    }
}
