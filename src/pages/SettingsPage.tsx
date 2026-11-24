import React, { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { formatKey, Settings, Snapshot } from "../types";

interface Props {
  settings: Settings;
  snap: Snapshot;
  keyLabels: Record<string, string>;
  listeningId: string | null;
  onRequestBind: (id: string, onCaptured: (key: string) => void) => void;
  onCancelBind: () => void;
  onUpdateSettings: (patch: Partial<Settings>) => void;
  onReconnect: () => void;
  onRunSetupWizard: () => void;
}

export const SettingsPage: React.FC<Props> = ({
  settings,
  snap,
  keyLabels,
  listeningId,
  onRequestBind,
  onCancelBind,
  onUpdateSettings,
  onReconnect,
  onRunSetupWizard,
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-sub">
            Hotkeys, virtual controller driver, and low-latency engine preferences.
          </div>
        </div>
        <button className="btn btn-sm" onClick={onRunSetupWizard}>
          Run Setup Wizard
        </button>
      </div>

      {/* Hotkeys & Driver */}
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>
          <span>Hotkeys &amp; Virtual Controller Driver</span>
          <span className={`tag ${snap.connected ? "tag-green" : "tag-red"}`}>
            {snap.connected ? "ViGEmBus Ready" : "Disconnected"}
          </span>
        </div>

        <div className="field-row">
          <div>
            <div className="field-label">Global Enable / Pause Hotkey</div>
            <div className="field-hint">Works anywhere, including fullscreen games and streams</div>
          </div>
          <button
            className={`kbd kbd-btn ${listeningId === "toggle-key" ? "listening" : ""}`}
            onClick={() =>
              listeningId === "toggle-key"
                ? onCancelBind()
                : onRequestBind("toggle-key", (k) => {
                    if (k === "Mouse1" || k === "Mouse2") return;
                    onUpdateSettings({ toggle_key: k });
                  })
            }
          >
            {listeningId === "toggle-key"
              ? "Press key..."
              : formatKey(settings.toggle_key, keyLabels)}
          </button>
        </div>

        <div className="field-row">
          <div>
            <div className="field-label">Hold-to-Free-Cursor Key</div>
            <div className="field-hint">
              Temporarily releases cursor &amp; keys to Windows while held
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button
              className={`kbd kbd-btn ${listeningId === "hold-release-key" ? "listening" : ""}`}
              onClick={() =>
                listeningId === "hold-release-key"
                  ? onCancelBind()
                  : onRequestBind("hold-release-key", (k) => {
                      if (k === "Mouse1" || k === "Mouse2") return;
                      onUpdateSettings({ hold_release_key: k });
                    })
              }
            >
              {listeningId === "hold-release-key"
                ? "Press key..."
                : settings.hold_release_key
                ? formatKey(settings.hold_release_key, keyLabels)
                : "Off"}
            </button>
            {settings.hold_release_key && (
              <button
                className="btn btn-sm btn-ghost"
                title="Disable hold-to-release"
                onClick={() => onUpdateSettings({ hold_release_key: "" })}
              >
                ×
              </button>
            )}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            paddingTop: 12,
            borderTop: "1px solid var(--border)",
          }}
        >
          <button className="btn btn-sm" onClick={onReconnect}>
            Reconnect Virtual Controller
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => openUrl("https://github.com/nefarius/ViGEmBus/releases/latest")}
          >
            Download ViGEmBus ↗
          </button>
        </div>
      </div>

      {/* Collapsible Advanced Engine Drawer */}
      <div className="drawer">
        <button className="drawer-toggle" onClick={() => setShowAdvanced((v) => !v)}>
          <span>
            Advanced Engine{" "}
            <span className="card-title-muted" style={{ marginLeft: 8 }}>
              {settings.output_hz} Hz tick rate, auto-focus, cursor lock, input blocking &amp; priority
            </span>
          </span>
          <span className={`drawer-chevron ${showAdvanced ? "open" : ""}`}>▾</span>
        </button>

        {showAdvanced && (
          <div className="drawer-body">
            <div className="field">
              <span className="field-label">Engine Tick Rate</span>
              <div className="seg" style={{ width: "100%" }}>
                {[250, 500, 1000, 2000].map((hz) => (
                  <button
                    key={hz}
                    className={`seg-btn ${settings.output_hz === hz ? "active" : ""}`}
                    style={{ flex: 1 }}
                    onClick={() => onUpdateSettings({ output_hz: hz })}
                  >
                    {hz} Hz
                  </button>
                ))}
              </div>
              <span className="field-hint">
                1000 Hz (1 ms) is optimal. Key presses wake the engine immediately at any tick rate.
              </span>
            </div>

            <div className="grid-2" style={{ gap: 16 }}>
              <div className="field-row">
                <div>
                  <div className="field-label">Auto-Pause Outside Target Window</div>
                  <div className="field-hint">Releases mouse &amp; keys on Alt-Tab</div>
                </div>
                <button
                  className={`switch ${settings.auto_focus ? "on" : ""}`}
                  onClick={() => onUpdateSettings({ auto_focus: !settings.auto_focus })}
                />
              </div>

              <div className="field-row">
                <div>
                  <div className="field-label">Lock Mouse Cursor to Window</div>
                  <div className="field-hint">Keeps cursor inside stream while active</div>
                </div>
                <button
                  className={`switch ${settings.lock_cursor ? "on" : ""}`}
                  onClick={() => onUpdateSettings({ lock_cursor: !settings.lock_cursor })}
                />
              </div>

              <div className="field-row">
                <div>
                  <div className="field-label">Block Native Keyboard &amp; Mouse Input</div>
                  <div className="field-hint">Win &amp; Alt+Tab always pass through</div>
                </div>
                <button
                  className={`switch ${settings.block_input ? "on" : ""}`}
                  onClick={() => onUpdateSettings({ block_input: !settings.block_input })}
                />
              </div>

              <div className="field-row">
                <div>
                  <div className="field-label">High Process Priority &amp; Disable EcoQoS</div>
                  <div className="field-hint">Keeps background timers exact in fullscreen</div>
                </div>
                <button
                  className={`switch ${settings.high_priority ? "on" : ""}`}
                  onClick={() => onUpdateSettings({ high_priority: !settings.high_priority })}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};
