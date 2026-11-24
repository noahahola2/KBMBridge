import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AppWindow,
  COMPANION_PRESETS,
  CompanionMode,
  CONSOLE_SOURCES,
  ConsoleSource,
  ControllerType,
  Settings,
} from "../types";

interface Props {
  settings: Settings;
  onUpdateSettings: (patch: Partial<Settings>) => void;
}

export const StreamingPage: React.FC<Props> = ({ settings, onUpdateSettings }) => {
  const [windows, setWindows] = useState<AppWindow[]>([]);

  const refreshApps = () => {
    invoke<AppWindow[]>("list_apps")
      .then(setWindows)
      .catch(() => {});
  };

  useEffect(() => {
    if (settings.companion !== "ControllerOnly") {
      refreshApps();
    }
  }, [settings.companion]);

  const selectConsoleSource = (src: ConsoleSource) => {
    const info = CONSOLE_SOURCES[src];
    const patch: Partial<Settings> = {
      console_source: src,
      controller: info.defaultController,
      connection: info.defaultConnection,
    };
    if (settings.companion === "RemotePlayClient") {
      patch.video_app = info.defaultStreamExe;
    }
    onUpdateSettings(patch);
  };

  const selectCompanion = (mode: CompanionMode) => {
    const preset = COMPANION_PRESETS[mode];
    const exe =
      mode === "RemotePlayClient"
        ? CONSOLE_SOURCES[settings.console_source].defaultStreamExe
        : mode === "Custom"
        ? settings.video_app
        : preset.defaultExe;
    onUpdateSettings({
      companion: mode,
      video_app: exe,
      auto_focus: mode !== "ControllerOnly" ? true : settings.auto_focus,
    });
  };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Streaming &amp; Apps</div>
          <div className="page-sub">
            Connect PS5 Streaming, Xbox Streaming, or Capture Card and pair with Veyra or PushFPS.
          </div>
        </div>
      </div>

      {/* Console Connection */}
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>
          <span>Console Connection</span>
        </div>

        <div className="grid-3">
          {(["Ps5Streaming", "XboxStreaming", "CaptureCard"] as ConsoleSource[]).map((src) => {
            const info = CONSOLE_SOURCES[src];
            return (
              <button
                key={src}
                className={`mode-card ${settings.console_source === src ? "active" : ""}`}
                onClick={() => selectConsoleSource(src)}
              >
                <div className="mode-card-title">{info.label}</div>
                <div className="mode-card-desc">{info.desc}</div>
              </button>
            );
          })}
        </div>

        <div className="field-row" style={{ paddingTop: 10, borderTop: "1px solid var(--border)" }}>
          <div>
            <div className="field-label">Virtual Controller Output</div>
            <div className="field-hint">
              PlayStation for PS5 Remote Play / Chiaki; Xbox for Xbox Streaming or PC games
            </div>
          </div>
          <div className="seg">
            {(
              [
                ["DualShock4", "PlayStation (PS5 / DS4)"],
                ["Xbox360", "Xbox 360"],
              ] as [ControllerType, string][]
            ).map(([v, label]) => (
              <button
                key={v}
                className={`seg-btn ${settings.controller === v ? "active" : ""}`}
                onClick={() => onUpdateSettings({ controller: v })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* App Pairing */}
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>
          <span>Companion App Pairing</span>
        </div>

        <div className="grid-3">
          {(Object.keys(COMPANION_PRESETS) as CompanionMode[]).map((mode) => {
            const info = COMPANION_PRESETS[mode];
            return (
              <button
                key={mode}
                className={`mode-card ${settings.companion === mode ? "active" : ""}`}
                onClick={() => selectCompanion(mode)}
              >
                <div className="mode-card-title">{info.label}</div>
                <div className="mode-card-desc">{info.desc}</div>
              </button>
            );
          })}
        </div>

        {settings.companion !== "ControllerOnly" && (
          <div className="field" style={{ paddingTop: 10, borderTop: "1px solid var(--border)" }}>
            <div className="field-row">
              <span className="field-label">Target Window Executable(s)</span>
              <button className="btn btn-sm btn-ghost" onClick={refreshApps}>
                Refresh running apps
              </button>
            </div>
            <input
              className="input"
              placeholder="e.g. Veyra.exe;PushFPS.exe;chiaki-ng.exe"
              value={settings.video_app}
              onChange={(e) =>
                onUpdateSettings({ video_app: e.target.value, companion: "Custom" })
              }
            />
            {windows.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                {windows.slice(0, 10).map((w) => (
                  <button
                    key={w.exe}
                    className="pill"
                    onClick={() =>
                      onUpdateSettings({ video_app: w.exe, companion: "Custom", auto_focus: true })
                    }
                    title={w.title}
                  >
                    {w.exe}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
};
