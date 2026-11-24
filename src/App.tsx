import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AppTab, Dashboard } from "./pages/Dashboard";
import { ProfilesPage } from "./pages/ProfilesPage";
import { StreamingPage } from "./pages/StreamingPage";
import { InputsPage } from "./pages/InputsPage";
import { AimPage } from "./pages/AimPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SetupWizard } from "./components/SetupWizard";
import {
  Bootstrap,
  ControllerType,
  EMPTY_SNAPSHOT,
  Profile,
  Settings,
  Snapshot,
} from "./types";

export const App: React.FC = () => {
  const [tab, setTab] = useState<AppTab>("dashboard");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [keyLabels, setKeyLabels] = useState<Record<string, string>>({});
  const [snap, setSnap] = useState<Snapshot>(EMPTY_SNAPSHOT);
  const [listeningId, setListeningId] = useState<string | null>(null);
  const bindCbRef = useRef<((key: string) => void) | null>(null);

  useEffect(() => {
    invoke<Bootstrap>("bootstrap")
      .then((b) => {
        setSettings(b.settings);
        setProfiles(b.profiles);
        setKeyLabels(b.key_labels);
      })
      .catch(console.error);

    const unlistenState = listen<Snapshot>("engine-state", (e) => {
      setSnap(e.payload);
    });

    const unlistenBind = listen<string>("bind-captured", (e) => {
      const cb = bindCbRef.current;
      bindCbRef.current = null;
      setListeningId(null);
      if (cb) cb(e.payload);
    });

    const unlistenSwitch = listen<string>("profile-switched", (e) => {
      setSettings((prev) => (prev ? { ...prev, active_profile: e.payload } : prev));
    });

    return () => {
      unlistenState.then((f) => f());
      unlistenBind.then((f) => f());
      unlistenSwitch.then((f) => f());
    };
  }, []);

  const requestBind = (id: string, onCaptured: (key: string) => void) => {
    bindCbRef.current = onCaptured;
    setListeningId(id);
    invoke("start_bind").catch(console.error);
  };

  const cancelBind = () => {
    bindCbRef.current = null;
    setListeningId(null);
    invoke("cancel_bind").catch(console.error);
  };

  const updateSettings = (patch: Partial<Settings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    invoke("save_settings", { settings: next }).catch(console.error);
  };

  const selectProfile = (id: string) => {
    if (!settings) return;
    setSettings({ ...settings, active_profile: id });
    invoke("set_active_profile", { id }).catch(console.error);
  };

  const createProfile = async (name: string, game: string) => {
    try {
      const created = await invoke<Profile>("create_profile", { name, game });
      setProfiles((prev) => [...prev, created]);
      setSettings((prev) => (prev ? { ...prev, active_profile: created.id } : prev));
    } catch (err) {
      console.error(err);
    }
  };

  const saveProfile = (p: Profile) => {
    setProfiles((prev) => prev.map((x) => (x.id === p.id ? p : x)));
    invoke("save_profile", { profile: p }).catch(console.error);
  };

  const deleteProfile = async (id: string) => {
    try {
      const next = await invoke<Profile[]>("delete_profile", { id });
      setProfiles(next);
      setSettings((prev) =>
        prev && !next.some((p) => p.id === prev.active_profile)
          ? { ...prev, active_profile: next[0]?.id ?? "gta6" }
          : prev
      );
    } catch (err) {
      console.error(err);
    }
  };

  const toggleArmed = () => {
    invoke("set_armed", { on: !snap.armed }).catch(console.error);
  };

  const reconnect = () => {
    invoke("reconnect_controller").catch(console.error);
  };

  if (!settings || profiles.length === 0) {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100vh", color: "var(--text-dim)" }}>
        Loading KBMBridge…
      </div>
    );
  }

  const activeProfile =
    profiles.find((p) => p.id === settings.active_profile) ?? profiles[0];

  if (!settings.setup_completed) {
    return (
      <SetupWizard
        settings={settings}
        profile={activeProfile}
        snap={snap}
        onReconnect={reconnect}
        onComplete={(nextSettings, nextProfile) => {
          setSettings(nextSettings);
          setProfiles((prev) => prev.map((x) => (x.id === nextProfile.id ? nextProfile : x)));
          invoke("save_profile", { profile: nextProfile }).catch(console.error);
          invoke("save_settings", { settings: nextSettings }).catch(console.error);
        }}
      />
    );
  }

  const dotClass = !snap.connected
    ? "red"
    : snap.active
    ? "green"
    : snap.armed
    ? "amber"
    : "gray";

  const statusText = !snap.connected
    ? "Offline"
    : snap.armed && snap.temp_released
    ? "Cursor Free"
    : snap.active
    ? "Active"
    : snap.armed
    ? "Waiting"
    : "Paused";

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand-top">
          <div className="brand-logo">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <rect x="2" y="6" width="20" height="12" rx="5" />
              <path d="M6 12h4M8 10v4" strokeLinecap="round" />
              <circle cx="15.5" cy="11" r="1" fill="currentColor" />
              <circle cx="18" cy="13" r="1" fill="currentColor" />
            </svg>
          </div>
          <div className="brand-name">KBMBridge</div>
        </div>

        <div className="nav-section">
          <div className="nav-group-label">Main</div>
          <button
            className={`nav-item ${tab === "dashboard" ? "active" : ""}`}
            onClick={() => setTab("dashboard")}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="9" rx="1.5" />
              <rect x="14" y="3" width="7" height="5" rx="1.5" />
              <rect x="14" y="12" width="7" height="9" rx="1.5" />
              <rect x="3" y="16" width="7" height="5" rx="1.5" />
            </svg>
            Dashboard
          </button>
          <button
            className={`nav-item ${tab === "profiles" ? "active" : ""}`}
            onClick={() => setTab("profiles")}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 7h16M4 12h16M4 17h10" strokeLinecap="round" />
            </svg>
            Profiles
          </button>
        </div>

        <div className="nav-section">
          <div className="nav-group-label">Play</div>
          <button
            className={`nav-item ${tab === "streaming" ? "active" : ""}`}
            onClick={() => setTab("streaming")}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="4" width="20" height="14" rx="2" />
              <path d="M8 21h8M12 18v3" strokeLinecap="round" />
            </svg>
            Streaming &amp; Apps
          </button>
        </div>

        <div className="nav-section">
          <div className="nav-group-label">Controls</div>
          <button
            className={`nav-item ${tab === "mapping" ? "active" : ""}`}
            onClick={() => setTab("mapping")}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="6" width="20" height="12" rx="4" />
              <path d="M6 12h4M8 10v4" strokeLinecap="round" />
              <circle cx="15.5" cy="11" r="1" fill="currentColor" />
              <circle cx="18" cy="13" r="1" fill="currentColor" />
            </svg>
            Mapping
          </button>
          <button
            className={`nav-item ${tab === "aim" ? "active" : ""}`}
            onClick={() => setTab("aim")}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="8" />
              <circle cx="12" cy="12" r="2.2" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" />
            </svg>
            Mouse &amp; Aim
          </button>
        </div>

        <div className="nav-section">
          <div className="nav-group-label">System</div>
          <button
            className={`nav-item ${tab === "settings" ? "active" : ""}`}
            onClick={() => setTab("settings")}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.79 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Settings
          </button>
        </div>

        <div className="sidebar-footer">
          <div className="status-pill">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontWeight: 600 }}>
              <span className={`dot ${dotClass}`} />
              {statusText}
            </span>
            <span style={{ color: "var(--text-muted)" }}>{activeProfile.name}</span>
          </div>
        </div>
      </aside>

      <main className="main">
        {tab === "dashboard" && (
          <Dashboard
            snap={snap}
            settings={settings}
            profiles={profiles}
            activeProfile={activeProfile}
            keyLabels={keyLabels}
            onToggleArmed={toggleArmed}
            onReconnect={reconnect}
            onUpdateSettings={updateSettings}
            onSelectProfile={selectProfile}
            onNavigate={setTab}
          />
        )}

        {tab === "profiles" && (
          <ProfilesPage
            profiles={profiles}
            activeId={activeProfile.id}
            onSelectProfile={selectProfile}
            onCreateProfile={createProfile}
            onSaveProfile={saveProfile}
            onDeleteProfile={deleteProfile}
            onEditMapping={(id) => {
              selectProfile(id);
              setTab("mapping");
            }}
          />
        )}

        {tab === "streaming" && (
          <StreamingPage settings={settings} onUpdateSettings={updateSettings} />
        )}

        {tab === "mapping" && (
          <InputsPage
            profiles={profiles}
            activeProfile={activeProfile}
            controller={settings.controller}
            pad={snap.pad}
            active={snap.active}
            hudMatch={snap.hud_match}
            hudScores={snap.hud_scores}
            keyLabels={keyLabels}
            listeningId={listeningId}
            onRequestBind={requestBind}
            onCancelBind={cancelBind}
            onSelectProfile={selectProfile}
            onUpdateController={(c: ControllerType) => updateSettings({ controller: c })}
            onSaveProfile={saveProfile}
          />
        )}

        {tab === "aim" && (
          <AimPage
            profile={activeProfile}
            pad={snap.pad}
            onSaveProfile={saveProfile}
          />
        )}

        {tab === "settings" && (
          <SettingsPage
            settings={settings}
            snap={snap}
            keyLabels={keyLabels}
            listeningId={listeningId}
            onRequestBind={requestBind}
            onCancelBind={cancelBind}
            onUpdateSettings={updateSettings}
            onReconnect={reconnect}
            onRunSetupWizard={() => updateSettings({ setup_completed: false })}
          />
        )}
      </main>
    </div>
  );
};
