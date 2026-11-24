import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CurveEditor } from "../components/CurveEditor";
import { StickRadar } from "../components/StickRadar";
import { AimSettings, AimTarget, CurveMode, DeadzoneShape, PadState, Profile } from "../types";

interface Props {
  profile: Profile;
  pad: PadState;
  onSaveProfile: (p: Profile) => void;
}

const PRESETS: { name: string; patch: Partial<AimSettings> }[] = [
  {
    name: "GTA / Rockstar",
    patch: {
      sensitivity: 10.5,
      ads_multiplier: 0.65,
      curve_mode: "Exponent",
      exponent: 0.58,
      anti_deadzone: 0.06,
      deadzone_shape: "Radial",
      boost: 0.02,
      smoothing_ms: 3.5,
      overflow_ms: 0,
      dithering: true,
      max_output: 1.0,
    },
  },
  {
    name: "Linear 1:1",
    patch: {
      sensitivity: 10.0,
      ads_multiplier: 0.75,
      curve_mode: "Exponent",
      exponent: 1.0,
      anti_deadzone: 0.08,
      deadzone_shape: "Radial",
      boost: 0.0,
      smoothing_ms: 3.0,
      overflow_ms: 0,
      dithering: true,
      max_output: 1.0,
    },
  },
  {
    name: "Snappy FPS",
    patch: {
      sensitivity: 12.0,
      ads_multiplier: 0.65,
      curve_mode: "Exponent",
      exponent: 0.72,
      anti_deadzone: 0.12,
      deadzone_shape: "Radial",
      boost: 0.03,
      smoothing_ms: 3.0,
      overflow_ms: 40,
      dithering: true,
      max_output: 1.0,
    },
  },
];

export const AimPage: React.FC<Props> = ({ profile, pad, onSaveProfile }) => {
  const aim = profile.aim;
  const [calTab, setCalTab] = useState<"deadzone" | "turn">("deadzone");
  const [testActive, setTestActive] = useState(false);
  const [testVal, setTestVal] = useState(0.16);
  const [spinning, setSpinning] = useState(false);
  const spinStartRef = useRef<number>(0);
  const [lastSpinSec, setLastSpinSec] = useState<number | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const patchAim = (patch: Partial<AimSettings>) => {
    onSaveProfile({ ...profile, aim: { ...aim, ...patch } });
  };

  useEffect(() => {
    if (calTab === "turn" && spinning) {
      invoke("set_test_stick", { value: [1.0, 0] }).catch(() => {});
    } else if (calTab === "deadzone" && testActive) {
      invoke("set_test_stick", { value: [testVal, 0] }).catch(() => {});
    } else {
      invoke("set_test_stick", { value: null }).catch(() => {});
    }
  }, [calTab, testActive, testVal, spinning]);

  useEffect(() => {
    return () => {
      invoke("set_test_stick", { value: null }).catch(() => {});
    };
  }, []);

  const switchCalTab = (next: "deadzone" | "turn") => {
    setTestActive(false);
    setSpinning(false);
    setCalTab(next);
  };

  const startSpin = () => {
    setTestActive(false);
    spinStartRef.current = performance.now();
    setSpinning(true);
  };

  const stopSpin = () => {
    if (!spinning) return;
    setSpinning(false);
    const secs = (performance.now() - spinStartRef.current) / 1000;
    if (secs > 0.25 && secs < 15) {
      setLastSpinSec(secs);
      const dps = Math.round(360 / secs);
      patchAim({ max_turn_dps: Math.max(30, Math.min(1200, dps)), use_cm360: true });
    }
  };

  const stickX = aim.target === "LeftStick" ? pad.lx : pad.rx;
  const stickY = aim.target === "LeftStick" ? pad.ly : pad.ry;

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Mouse &amp; Aim</div>
          <div className="page-sub">
            Fine-tune mouse-to-stick feel and response curve for{" "}
            <strong style={{ color: "var(--text)" }}>{profile.name}</strong>.
          </div>
        </div>
      </div>

      {/* Presets & Mode Bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div className="pill-row">
          <span className="field-hint" style={{ marginRight: 4 }}>Presets</span>
          {PRESETS.map((pr) => (
            <button key={pr.name} className="pill" onClick={() => patchAim(pr.patch)}>
              {pr.name}
            </button>
          ))}
        </div>

        <div className="seg">
          <button
            className={`seg-btn ${!aim.use_cm360 ? "active" : ""}`}
            onClick={() => patchAim({ use_cm360: false })}
          >
            Simple
          </button>
          <button
            className={`seg-btn ${aim.use_cm360 ? "active" : ""}`}
            onClick={() => patchAim({ use_cm360: true })}
          >
            DPI + cm/360°
          </button>
        </div>
      </div>

      <div className="grid-2" style={{ alignItems: "start" }}>
        {/* Left Card: Radar + Curve + Core Sliders */}
        <div className="card">
          <div className="card-title">
            <span>Mouse Response</span>
            <span className="card-title-muted">Set in-game sensitivity to max</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <StickRadar
              x={stickX}
              y={stickY}
              antiDeadzone={aim.anti_deadzone}
              maxOutput={aim.max_output}
            />
            <CurveEditor
              aim={aim}
              onChangePoints={(curve_points) => patchAim({ curve_points })}
            />
          </div>

          {!aim.use_cm360 ? (
            <div className="slider-row">
              <div className="slider-head">
                <span className="field-label">Sensitivity</span>
                <span className="slider-val">{aim.sensitivity.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min={1}
                max={30}
                step={0.5}
                value={aim.sensitivity}
                onChange={(e) => patchAim({ sensitivity: Number(e.target.value) })}
              />
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 4 }}>
              <div className="field">
                <span className="field-label">Mouse DPI</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {[400, 800, 1600, 3200].map((v) => (
                    <button
                      key={v}
                      className={`pill ${aim.mouse_dpi === v ? "active" : ""}`}
                      onClick={() => patchAim({ mouse_dpi: v })}
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
                    style={{ width: 82, padding: "4px 8px" }}
                    value={aim.mouse_dpi}
                    onChange={(e) => patchAim({ mouse_dpi: Number(e.target.value) || 800 })}
                  />
                </div>
              </div>

              <div className="slider-row" style={{ padding: "4px 0" }}>
                <div className="slider-head">
                  <span className="field-label">cm / 360°</span>
                  <span className="slider-val">{aim.cm_per_360.toFixed(1)} cm</span>
                </div>
                <input
                  type="range"
                  min={8}
                  max={70}
                  step={0.5}
                  value={aim.cm_per_360}
                  onChange={(e) => patchAim({ cm_per_360: Number(e.target.value) })}
                />
              </div>
            </div>
          )}

          <div className="slider-row">
            <div className="slider-head">
              <span className="field-label">ADS Sensitivity (L2 / LT)</span>
              <span className="slider-val">{Math.round(aim.ads_multiplier * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.2}
              max={1.5}
              step={0.02}
              value={aim.ads_multiplier}
              onChange={(e) => patchAim({ ads_multiplier: Number(e.target.value) })}
            />
          </div>

          <div className="slider-row">
            <div className="slider-head">
              <span className="field-label">Anti-Deadzone</span>
              <span className="slider-val">{Math.round(aim.anti_deadzone * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={0.45}
              step={0.01}
              value={aim.anti_deadzone}
              onChange={(e) => patchAim({ anti_deadzone: Number(e.target.value) })}
            />
          </div>

          <div className="field-row" style={{ marginTop: 8 }}>
            <span className="field-label">Output Curve</span>
            <div className="pill-row">
              {(["Exponent", "Custom"] as CurveMode[]).map((m) => (
                <button
                  key={m}
                  className={`pill ${aim.curve_mode === m ? "active" : ""}`}
                  onClick={() => patchAim({ curve_mode: m })}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {aim.curve_mode === "Exponent" ? (
            <div className="slider-row">
              <div className="slider-head">
                <span className="field-label">Curve Exponent</span>
                <span className="slider-val">{aim.exponent.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0.3}
                max={2.0}
                step={0.02}
                value={aim.exponent}
                onChange={(e) => patchAim({ exponent: Number(e.target.value) })}
              />
            </div>
          ) : (
            <div className="field-hint" style={{ marginTop: 6 }}>
              Drag the violet points on the curve box to customize.
            </div>
          )}

          <div
            className="field-row"
            style={{ paddingTop: 10, borderTop: "1px solid var(--border)", marginTop: 8 }}
          >
            <span className="field-label">Invert Y Axis</span>
            <button
              className={`switch ${aim.invert_y ? "on" : ""}`}
              onClick={() => patchAim({ invert_y: !aim.invert_y })}
            />
          </div>
        </div>

        {/* Right Card: Calibration */}
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>
            <span>Calibration</span>
            <div className="seg">
              <button
                className={`seg-btn ${calTab === "deadzone" ? "active" : ""}`}
                onClick={() => switchCalTab("deadzone")}
              >
                Deadzone Finder
              </button>
              <button
                className={`seg-btn ${calTab === "turn" ? "active" : ""}`}
                onClick={() => switchCalTab("turn")}
              >
                360° Turn Match
              </button>
            </div>
          </div>

          {calTab === "deadzone" ? (
            <>
              <p className="field-hint">
                Enable Test Stick and slowly raise the slider until your in-game camera barely begins drifting — that is your game's exact deadzone.
              </p>
              <div className="slider-row">
                <div className="slider-head">
                  <span className="field-label">Test Stick Deflection</span>
                  <span className="slider-val">{Math.round(testVal * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0.01}
                  max={0.35}
                  step={0.01}
                  value={testVal}
                  onChange={(e) => setTestVal(Number(e.target.value))}
                />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className={`btn btn-sm ${testActive ? "btn-danger" : ""}`}
                  onClick={() => setTestActive((v) => !v)}
                >
                  {testActive ? "Stop Test" : "Start Test"}
                </button>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => {
                    patchAim({ anti_deadzone: Number(Math.max(0, testVal - 0.01).toFixed(2)) });
                    setTestActive(false);
                  }}
                >
                  Apply ({Math.max(0, Math.round((testVal - 0.01) * 100))}%)
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="field-hint">
                Press and hold in-game, then release the moment your camera finishes one full 360° spin ({Math.round(aim.max_turn_dps)}°/s calibrated).
              </p>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button
                  className={`btn btn-sm ${spinning ? "btn-danger" : "btn-primary"}`}
                  onPointerDown={startSpin}
                  onPointerUp={stopSpin}
                  onPointerLeave={stopSpin}
                >
                  {spinning ? "Spinning… Release at 360°" : "Hold to Measure 360°"}
                </button>
                {lastSpinSec !== null && (
                  <span className="field-hint">
                    {lastSpinSec.toFixed(2)}s → {Math.round(360 / lastSpinSec)}°/s
                  </span>
                )}
              </div>
            </>
          )}

          <div className="banner" style={{ marginTop: 4 }}>
            <span>
              <strong>Tip:</strong> Set controller Look Sensitivity to maximum inside your game so fast mouse flicks aren't capped early.
            </span>
          </div>

          <div className="card-inner" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
              Recommended In-Game Settings (GTA VI)
            </div>
            <div className="grid-2" style={{ gap: 6, fontSize: 11.5, color: "var(--text-dim)" }}>
              <span>Look &amp; Aim Sens: <strong style={{ color: "var(--text)" }}>14</strong></span>
              <span>Look &amp; Aim Accel: <strong style={{ color: "var(--text)" }}>14</strong></span>
              <span>Response Curve: <strong style={{ color: "var(--text)" }}>Aggressive (4/4)</strong></span>
              <span>Deadzone: <strong style={{ color: "var(--text)" }}>LS 7 · RS 3</strong></span>
            </div>
          </div>
        </div>
      </div>

      {/* Collapsible Advanced Mouse Tuning Drawer */}
      <div className="drawer">
        <button className="drawer-toggle" onClick={() => setShowAdvanced((v) => !v)}>
          <span>
            Advanced Mouse Tuning{" "}
            <span className="card-title-muted" style={{ marginLeft: 8 }}>
              Target stick, Y/X ratio, velocity window, boost, overflow carry &amp; dithering
            </span>
          </span>
          <span className={`drawer-chevron ${showAdvanced ? "open" : ""}`}>▾</span>
        </button>

        {showAdvanced && (
          <div className="drawer-body">
            <div className="grid-2" style={{ gap: 16 }}>
              <div className="field-row">
                <span className="field-label">Aim Target Stick</span>
                <div className="seg">
                  {(
                    [
                      ["RightStick", "Right"],
                      ["LeftStick", "Left"],
                      ["Off", "Off"],
                    ] as [AimTarget, string][]
                  ).map(([val, label]) => (
                    <button
                      key={val}
                      className={`seg-btn ${aim.target === val ? "active" : ""}`}
                      onClick={() => patchAim({ target: val })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field-row">
                <span className="field-label">Deadzone Shape</span>
                <div className="seg">
                  {(["Radial", "Axial"] as DeadzoneShape[]).map((s) => (
                    <button
                      key={s}
                      className={`seg-btn ${aim.deadzone_shape === s ? "active" : ""}`}
                      onClick={() => patchAim({ deadzone_shape: s })}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div className="slider-row">
                <div className="slider-head">
                  <span className="field-label">Vertical / Horizontal Ratio</span>
                  <span className="slider-val">{aim.y_ratio.toFixed(2)}×</span>
                </div>
                <input
                  type="range"
                  min={0.4}
                  max={1.8}
                  step={0.02}
                  value={aim.y_ratio}
                  onChange={(e) => patchAim({ y_ratio: Number(e.target.value) })}
                />
              </div>

              <div className="slider-row">
                <div className="slider-head">
                  <span className="field-label">Adaptive Velocity Window</span>
                  <span className="slider-val">{aim.smoothing_ms.toFixed(1)} ms</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={16}
                  step={0.5}
                  value={aim.smoothing_ms}
                  onChange={(e) => patchAim({ smoothing_ms: Number(e.target.value) })}
                />
              </div>

              <div className="slider-row">
                <div className="slider-head">
                  <span className="field-label">Initial Boost</span>
                  <span className="slider-val">{Math.round(aim.boost * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={0.3}
                  step={0.01}
                  value={aim.boost}
                  onChange={(e) => patchAim({ boost: Number(e.target.value) })}
                />
              </div>

              <div className="slider-row">
                <div className="slider-head">
                  <span className="field-label">Overflow Carry</span>
                  <span className="slider-val">
                    {aim.overflow_ms === 0 ? "Off" : `${Math.round(aim.overflow_ms)} ms`}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={150}
                  step={5}
                  value={aim.overflow_ms}
                  onChange={(e) => patchAim({ overflow_ms: Number(e.target.value) })}
                />
              </div>

              <div className="slider-row">
                <div className="slider-head">
                  <span className="field-label">Outer Stick Cap</span>
                  <span className="slider-val">{Math.round(aim.max_output * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0.6}
                  max={1.0}
                  step={0.01}
                  value={aim.max_output}
                  onChange={(e) => patchAim({ max_output: Number(e.target.value) })}
                />
              </div>

              <div className="field-row">
                <div>
                  <div className="field-label">Sub-Step Temporal Dithering</div>
                  <div className="field-hint">Smooth micro-aim on 8-bit PlayStation sticks</div>
                </div>
                <button
                  className={`switch ${aim.dithering ? "on" : ""}`}
                  onClick={() => patchAim({ dithering: !aim.dithering })}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};
