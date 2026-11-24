import React from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ControllerSvg } from "../components/ControllerSvg";
import {
  COMPANION_PRESETS,
  CONSOLE_SOURCES,
  ControllerType,
  formatKey,
  Profile,
  Settings,
  Snapshot,
} from "../types";

export type AppTab =
  | "dashboard"
  | "profiles"
  | "streaming"
  | "mapping"
  | "aim"
  | "settings";

interface Props {
  snap: Snapshot;
  settings: Settings;
  profiles: Profile[];
  activeProfile: Profile;
  keyLabels: Record<string, string>;
  onToggleArmed: () => void;
  onReconnect: () => void;
  onUpdateSettings: (patch: Partial<Settings>) => void;
  onSelectProfile: (id: string) => void;
  onNavigate: (tab: AppTab) => void;
}

export const Dashboard: React.FC<Props> = ({
  snap,
  settings,
  profiles,
  activeProfile,
  keyLabels,
  onToggleArmed,
  onReconnect,
  onUpdateSettings,
  onSelectProfile,
  onNavigate,
}) => {
  const statusPill = (() => {
    if (!snap.connected) return { label: "Offline", cls: "tag-red" };
    if (snap.armed && snap.temp_released) return { label: "Cursor Free", cls: "tag-amber" };
    if (snap.active) return { label: "Connected", cls: "tag-green" };
    if (snap.armed && !snap.focus_ok) return { label: "Waiting Focus", cls: "tag-amber" };
    return { label: "Ready", cls: "tag-green" };
  })();

  const latencyMs =
    snap.mouse_latency_us > 0
      ? `${(snap.mouse_latency_us / 1000).toFixed(2)} ms`
      : snap.key_latency_us > 0
      ? `${(snap.key_latency_us / 1000).toFixed(2)} ms`
      : "—";

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-sub">Your virtual controller, active profile, and output at a glance.</div>
        </div>
      </div>

      {/* Top status banner */}
      {!snap.connected ? (
        <div className="banner banner-warn">
          <div>
            <strong>ViGEmBus driver not detected.</strong>{" "}
            <span style={{ opacity: 0.88 }}>
              Install ViGEmBus once so Windows detects your virtual controller.
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button
              className="btn btn-sm"
              onClick={() => openUrl("https://github.com/nefarius/ViGEmBus/releases/latest")}
            >
              Download
            </button>
            <button className="btn btn-sm btn-primary" onClick={onReconnect}>
              Reconnect
            </button>
          </div>
        </div>
      ) : !snap.armed ? (
        <div className="banner">
          <div>
            <strong>Bridge output is paused.</strong>{" "}
            <span style={{ color: "var(--text-dim)" }}>
              Press <span className="kbd" style={{ padding: "1px 6px" }}>{formatKey(settings.toggle_key, keyLabels)}</span> or turn on Bridge to drive your game.
            </span>
          </div>
          <button className="btn btn-sm btn-primary" onClick={onToggleArmed}>
            Turn on
          </button>
        </div>
      ) : null}

      <div className="dash-split">
        {/* Left: Controller Showcase Card */}
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>KBMBridge</span>
                <span className="tag tag-muted">
                  {CONSOLE_SOURCES[settings.console_source].short}
                </span>
                <span className="tag tag-muted">{settings.output_hz} Hz</span>
              </div>
              <div className="field-hint" style={{ marginTop: 3 }}>
                {snap.active
                  ? `Active · ${snap.foreground || "Streaming window"}`
                  : snap.armed && !snap.focus_ok
                  ? `Waiting for ${settings.video_app || "target window"}`
                  : "Live input preview"}
              </div>
            </div>

            <span className={`tag ${statusPill.cls}`}>{statusPill.label}</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="field-hint">Output</span>
            <select
              className="select"
              style={{ padding: "4px 8px", fontSize: 12 }}
              value={settings.controller}
              onChange={(e) => onUpdateSettings({ controller: e.target.value as ControllerType })}
            >
              <option value="DualShock4">PlayStation (PS5 / DS4)</option>
              <option value="Xbox360">Xbox 360 / Series</option>
            </select>
            <span className="field-hint" style={{ marginLeft: 4 }}>
              {COMPANION_PRESETS[settings.companion].label}
            </span>
          </div>

          <div style={{ padding: "6px 0" }}>
            <ControllerSvg
              pad={snap.pad}
              controller={settings.controller}
              active={snap.active}
              compact
              onClickTarget={() => onNavigate("mapping")}
            />
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              paddingTop: 10,
              borderTop: "1px solid var(--border)",
              fontSize: 11.5,
              color: "var(--text-dim)",
            }}
          >
            <span>
              Latency: <strong style={{ color: "var(--text)" }}>{latencyMs}</strong> · Rate:{" "}
              <strong style={{ color: "var(--text)" }}>
                {Math.round(snap.submit_hz) || 0} Hz
              </strong>
            </span>
            <span>
              Focus: <strong style={{ color: "var(--text)" }}>{snap.foreground || "Desktop"}</strong>
            </span>
          </div>
        </div>

        {/* Right: Active Profile + Quick Actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>
              <span>Active profile</span>
              <span className="tag tag-accent">
                {snap.layers.length > 0 ? snap.layers[0] : "Base"}
              </span>
            </div>

            <select
              className="select"
              value={settings.active_profile}
              onChange={(e) => onSelectProfile(e.target.value)}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.game ? ` — ${p.game}` : ""}
                </option>
              ))}
            </select>

            <div className="pill-row">
              <button
                className={`pill ${snap.layers.length === 0 ? "active" : ""}`}
                style={{ padding: "4px 9px", fontSize: 11.5 }}
                onClick={() => invoke("set_active_layer", { index: null }).catch(() => {})}
              >
                {activeProfile.id === "gta6" ? "PS5 Menu" : "Base"}
              </button>
              {activeProfile.layers.map((l, idx) => {
                const isActive = snap.layers.includes(l.name);
                return (
                  <button
                    key={idx}
                    className={`pill ${isActive ? "active" : ""}`}
                    style={{ padding: "4px 9px", fontSize: 11.5 }}
                    onClick={() => invoke("set_active_layer", { index: idx }).catch(() => {})}
                  >
                    {l.name} · {formatKey(l.activator, keyLabels)}
                  </button>
                );
              })}
            </div>

            <div className="grid-2" style={{ gap: 10 }}>
              <div className="card-inner">
                <div className="field-hint">Mapping</div>
                <div style={{ color: "var(--accent-light)", fontWeight: 600, marginTop: 2 }}>
                  {activeProfile.bindings.length} bound
                </div>
              </div>
              <div className="card-inner">
                <div className="field-hint">Layers</div>
                <div style={{ color: "var(--accent-light)", fontWeight: 600, marginTop: 2 }}>
                  {activeProfile.layers.length} {activeProfile.layers.length === 1 ? "layer" : "layers"}
                </div>
              </div>
            </div>

            <button
              className="btn btn-sm"
              style={{ alignSelf: "flex-start" }}
              onClick={() => onNavigate("profiles")}
            >
              Manage profiles
            </button>
          </div>

          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="card-title" style={{ marginBottom: 2 }}>
              <span>Quick actions</span>
            </div>

            <div>
              <div className="qa-row">
                <span className="field-label">Bridge Output</span>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button
                    className={`switch ${snap.armed ? "on" : ""}`}
                    onClick={onToggleArmed}
                    aria-label="Toggle Bridge Output"
                  />
                  <button className="qa-link" onClick={() => onNavigate("settings")}>
                    {formatKey(settings.toggle_key, keyLabels)}
                  </button>
                </div>
              </div>
              {!snap.armed && (
                <div className="warn-text" style={{ marginBottom: 4 }}>
                  Your keyboard &amp; mouse inputs are not reaching any game while this is off.
                </div>
              )}
            </div>

            <div className="qa-row">
              <span className="field-label">Block Native Input</span>
              <button
                className={`switch ${settings.block_input ? "on" : ""}`}
                onClick={() => onUpdateSettings({ block_input: !settings.block_input })}
              />
            </div>

            <div className="qa-row">
              <span className="field-label">Lock Cursor</span>
              <button
                className={`switch ${settings.lock_cursor ? "on" : ""}`}
                onClick={() => onUpdateSettings({ lock_cursor: !settings.lock_cursor })}
              />
            </div>

            <div className="grid-2" style={{ gap: 8, marginTop: 6 }}>
              <button className="btn btn-sm" onClick={() => onNavigate("mapping")}>
                Remap controls
              </button>
              <button className="btn btn-sm" onClick={() => onNavigate("aim")}>
                Tune mouse
              </button>
              <button className="btn btn-sm" onClick={() => onNavigate("streaming")}>
                Streaming &amp; apps
              </button>
              <button className="btn btn-sm" onClick={() => onNavigate("settings")}>
                Settings
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
