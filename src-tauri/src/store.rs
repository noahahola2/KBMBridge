//! Profile / settings persistence.

use crate::profile::*;
use std::path::PathBuf;

pub struct Store {
    dir: PathBuf,
    pub settings: Settings,
    pub profiles: Vec<Profile>,
}

impl Store {
    pub fn load(dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(dir.join("profiles"));
        let settings = std::fs::read_to_string(dir.join("settings.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        let mut profiles: Vec<Profile> = std::fs::read_dir(dir.join("profiles"))
            .into_iter()
            .flatten()
            .flatten()
            .filter(|e| e.path().extension().map_or(false, |x| x == "json"))
            .filter_map(|e| std::fs::read_to_string(e.path()).ok())
            .filter_map(|s| serde_json::from_str::<Profile>(&s).ok())
            .collect();
        if !profiles.iter().any(|p| p.id == "gta6") {
            profiles.insert(0, gta6_profile());
        }
        profiles.sort_by(|a, b| b.builtin.cmp(&a.builtin).then(a.name.cmp(&b.name)));
        let mut s = Self { dir, settings, profiles };
        if !s.profiles.iter().any(|p| p.id == s.settings.active_profile) {
            s.settings.active_profile = s.profiles[0].id.clone();
        }
        s
    }

    pub fn active(&self) -> Profile {
        self.profiles
            .iter()
            .find(|p| p.id == self.settings.active_profile)
            .cloned()
            .unwrap_or_else(gta6_profile)
    }

    pub fn save_settings(&self) -> Result<(), String> {
        let json = serde_json::to_string_pretty(&self.settings).map_err(|e| e.to_string())?;
        std::fs::write(self.dir.join("settings.json"), json).map_err(|e| e.to_string())
    }

    fn profile_path(&self, id: &str) -> PathBuf {
        let safe: String = id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
        self.dir.join("profiles").join(format!("{safe}.json"))
    }

    pub fn save_profile(&mut self, p: Profile) -> Result<(), String> {
        let json = serde_json::to_string_pretty(&p).map_err(|e| e.to_string())?;
        std::fs::write(self.profile_path(&p.id), json).map_err(|e| e.to_string())?;
        match self.profiles.iter_mut().find(|x| x.id == p.id) {
            Some(x) => *x = p,
            None => self.profiles.push(p),
        }
        Ok(())
    }

    pub fn delete_profile(&mut self, id: &str) -> Result<(), String> {
        let _ = std::fs::remove_file(self.profile_path(id));
        if id == "gta6" {
            // Built-in: deleting resets it to defaults.
            if let Some(x) = self.profiles.iter_mut().find(|x| x.id == id) {
                *x = gta6_profile();
            }
            return Ok(());
        }
        self.profiles.retain(|p| p.id != id);
        if self.settings.active_profile == id {
            self.settings.active_profile = self.profiles[0].id.clone();
            self.save_settings()?;
        }
        Ok(())
    }
}
