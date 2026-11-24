import React, { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  COMPANION_PRESETS,
  CompanionMode,
  CONSOLE_SOURCES,
  ConsoleSource,
  ControllerType,
  Profile,
  Settings,
  Snapshot,
} from "../types";

interface Props {
  settings: Settings;
  profile: Profile;
  snap: Snapshot;
  onReconnect: () => void;
  onComplete: (nextSettings: Settings, nextProfile: Profile) => void;
}

const APP_MODES: CompanionMode[] = ["ControllerOnly", "Veyra", "PushFPS", "RemotePlayClient"];

export const SetupWizard: React.FC<Props> = ({
  settings,
  profile,
  snap,
  onReconnect,
  onComplete,
}) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [source, setSource] = useState<ConsoleSource>(settings.console_source);
  const [controller, setController] = useState<ControllerType>(settings.controller);
  const [companion, setCompanion] = useState<CompanionMode>(settings.companion);
  const [dpi, setDpi] = useState<number>(profile.aim.mouse_dpi || 800);

  const pickSource = (s: ConsoleSource) => {
    setSource(s);
    setController(CONSOLE_SOURCES[s].defaultController);
    if (s === "CaptureCard" && companion === "RemotePlayClient") {
      setCompanion("PushFPS");
    }
  };

  const finish = () => {
    const src = CONSOLE_SOURCES[source];
    const videoApp =
      companion === "RemotePlayClient"
        ? src.defaultStreamExe
        : companion === "Custom"
        ? settings.video_app
        : COMPANION_PRESETS[companion].defaultExe;

    const nextSettings: Settings = {
      ...settings,
      setup_completed: true,
      console_source: source,
      controller,
      connection: src.defaultConnection,
      companion,
      video_app: videoApp,
      auto_focus: companion !== "ControllerOnly",
    };

    const nextProfile: Profile = {
      ...profile,
      aim: {
        ...profile.aim,
        use_cm360: false,
        mouse_dpi: dpi,
      },
    };
    onComplete(nextSettings, nextProfile);
  };

  return (
    <div className="wizard-backdrop">
      <div className="wizard-shell">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <div className="brand-logo">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <rect x="2" y="6" width="20" height="12" rx="5" />
                <path d="M6 12h4M8 10v4" strokeLinecap="round" />
                <circle cx="15.5" cy="11" r="1" fill="currentColor" />
                <circle cx="18" cy="13" r="1" fill="currentColor" />
              </svg>
            </div>
            <div>
              <div className="brand-name" style={{ fontSize: 15 }}>Welcome to KBMBridge</div>
              <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>Step {step} of 2</div>
            </div>
          </div>

          <button className="btn btn-ghost btn-sm" onClick={finish}>
            Skip
          </button>
        </div>

        <div className="wizard-steps">
          <div className={`wizard-step-pill ${step >= 1 ? "active" : ""}`} />
          <div className={`wizard-step-pill ${step >= 2 ? "active" : ""}`} />
        </div>

        {/* STEP 1: Console & App Mode */}
        {step === 1 && (
          <>
            <div>
              <div className="page-title" style={{ fontSize: 18 }}>
                Console &amp; App Mode
              </div>
              <div className="page-sub">
                Choose how your console connects and whether to pair with Veyra, PushFPS, or Remote Play.
              </div>
            </div>

            <div className="wizard-source-grid">
              {(["Ps5Streaming", "XboxStreaming", "CaptureCard"] as ConsoleSource[]).map((s) => {
                const info = CONSOLE_SOURCES[s];
                return (
                  <button
                    key={s}
                    className={`wizard-card ${source === s ? "active" : ""}`}
                    onClick={() => pickSource(s)}
                  >
                    <div className="wizard-card-icon">
                      {s === "Ps5Streaming" && (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="4" width="18" height="12" rx="2" />
                          <path d="M8 20h8M12 16v4" />
                        </svg>
                      )}
                      {s === "XboxStreaming" && (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="9" />
                          <path d="M8 8l8 8M16 8l-8 8" />
                        </svg>
                      )}
                      {s === "CaptureCard" && (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="2" y="7" width="20" height="10" rx="2" />
                          <path d="M6 12h4M15 12h3" />
                        </svg>
                      )}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{info.label}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-dim)" }}>{info.desc}</div>
                  </button>
                );
              })}
            </div>

            {source === "CaptureCard" && (
              <div className="field">
                <span className="field-label">Virtual Controller Layout</span>
                <div className="seg" style={{ width: "100%" }}>
                  {(
                    [
                      ["DualShock4", "PlayStation (PS5 / DS4)"],
                      ["Xbox360", "Xbox Controller"],
                    ] as [ControllerType, string][]
                  ).map(([val, label]) => (
                    <button
                      key={val}
                      className={`seg-btn ${controller === val ? "active" : ""}`}
                      style={{ flex: 1 }}
                      onClick={() => setController(val)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="field">
              <span className="field-label">App Pairing</span>
              <div className="seg" style={{ width: "100%" }}>
                {APP_MODES.map((mode) => (
                  <button
                    key={mode}
                    className={`seg-btn ${companion === mode ? "active" : ""}`}
                    style={{ flex: 1 }}
                    onClick={() => setCompanion(mode)}
                  >
                    {COMPANION_PRESETS[mode].label}
                  </button>
                ))}
              </div>
              <span className="field-hint">{COMPANION_PRESETS[companion].desc}</span>
            </div>
          </>
        )}

        {/* STEP 2: Driver & Ready */}
        {step === 2 && (
          <>
            <div>
              <div className="page-title" style={{ fontSize: 18 }}>
                Driver &amp; Ready
              </div>
              <div className="page-sub">
                Confirm the virtual controller driver and save your mouse DPI.
              </div>
            </div>

            <div className={`banner ${snap.connected ? "banner-green" : "banner-warn"}`}>
              <div>
                <strong>{snap.connected ? "ViGEmBus Ready" : "ViGEmBus Driver Not Detected"}</strong>
                <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>
                  {snap.connected
                    ? "Virtual controller output is active and ready to play."
                    : "Install ViGEmBus once so Windows detects the virtual PlayStation / Xbox gamepad."}
                </div>
              </div>
              {!snap.connected && (
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button
                    className="btn btn-sm"
                    onClick={() => openUrl("https://github.com/nefarius/ViGEmBus/releases/latest")}
                  >
                    Download
                  </button>
                  <button className="btn btn-sm btn-primary" onClick={onReconnect}>
                    Check Again
                  </button>
                </div>
              )}
            </div>

            <div className="field">
              <span className="field-label">Mouse DPI</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {[400, 800, 1600, 3200].map((v) => (
                  <button
                    key={v}
                    className={`btn btn-sm ${dpi === v ? "btn-primary" : ""}`}
                    onClick={() => setDpi(v)}
                  >
                    {v}
                  </button>
                ))}
                <input
                  className="input"
                  type="number"
                  min={100}
                  max={30000}
                  step={50}
                  style={{ width: 96, padding: "5px 8px" }}
                  value={dpi}
                  onChange={(e) => setDpi(Number(e.target.value) || 800)}
                />
              </div>
              <span className="field-hint">
                Saved for optional cm/360° scaling later — Simple sensitivity is enabled by default.
              </span>
            </div>
          </>
        )}

        {/* Footer navigation */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            paddingTop: 14,
            borderTop: "1px solid var(--border)",
          }}
        >
          <button
            className="btn btn-ghost"
            disabled={step === 1}
            onClick={() => setStep(1)}
          >
            ← Back
          </button>

          {step === 1 ? (
            <button className="btn btn-primary" onClick={() => setStep(2)}>
              Continue →
            </button>
          ) : (
            <button className="btn btn-primary" onClick={finish}>
              Finish &amp; Open
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
