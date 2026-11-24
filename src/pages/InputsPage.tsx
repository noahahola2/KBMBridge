import React, { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ControllerSvg } from "../components/ControllerSvg";
import { HudPatchPreview } from "../components/HudPatchPreview";
import {
  ALL_TARGETS,
  AimTarget,
  Binding,
  BindMode,
  ControllerType,
  formatKey,
  HUD_ZONES,
  HudRule,
  HudSample,
  HudZone,
  Layer,
  PadState,
  Profile,
  Socd,
  Target,
  TARGET_META,
  targetLabel,
} from "../types";

interface Props {
  profiles: Profile[];
  activeProfile: Profile;
  controller: ControllerType;
  pad: PadState;
  active: boolean;
  hudMatch: string | null;
  hudScores: [string, number][];
  keyLabels: Record<string, string>;
  listeningId: string | null;
  onRequestBind: (id: string, onCaptured: (key: string) => void) => void;
  onCancelBind: () => void;
  onSelectProfile: (id: string) => void;
  onUpdateController: (c: ControllerType) => void;
  onSaveProfile: (p: Profile) => void;
}

const TOP_TARGETS: Target[] = ["L2", "L1", "Touchpad", "R1", "R2"];
const LEFT_TARGETS: Target[] = ["Share", "DpadUp", "DpadLeft", "DpadRight", "DpadDown", "L3"];
const RIGHT_TARGETS: Target[] = ["Options", "Triangle", "Square", "Circle", "Cross", "R3"];
const BOTTOM_TARGETS: Target[] = ["LsUp", "LsDown", "LsLeft", "LsRight", "PS", "Walk", "Feather"];
const GROUPS = ["Movement", "Triggers & Bumpers", "Face & Sticks", "D-Pad & System"] as const;

const bit = (b: number, i: number) => (b & (1 << i)) !== 0;

function isTargetPressed(t: Target, pad: PadState): boolean {
  const b = pad.buttons;
  switch (t) {
    case "Cross": return bit(b, 0);
    case "Circle": return bit(b, 1);
    case "Square": return bit(b, 2);
    case "Triangle": return bit(b, 3);
    case "L1": return bit(b, 4);
    case "R1": return bit(b, 5);
    case "L3": return bit(b, 6);
    case "R3": return bit(b, 7);
    case "Share": return bit(b, 8);
    case "Options": return bit(b, 9);
    case "PS": return bit(b, 10);
    case "Touchpad": return bit(b, 11);
    case "DpadUp": return bit(b, 12);
    case "DpadDown": return bit(b, 13);
    case "DpadLeft": return bit(b, 14);
    case "DpadRight": return bit(b, 15);
    case "L2": return pad.l2 > 0.05;
    case "R2": return pad.r2 > 0.05;
    case "LsUp": return pad.ly > 0.2;
    case "LsDown": return pad.ly < -0.2;
    case "LsLeft": return pad.lx < -0.2;
    case "LsRight": return pad.lx > 0.2;
    default: return false;
  }
}

function switchLayerLabel(sw: string | null): string {
  if (!sw) return "None";
  if (sw === "__prev__") return "← Previous Layer";
  if (sw === "__base__") return "→ Base (PS5 Menu)";
  return `→ ${sw}`;
}

export const InputsPage: React.FC<Props> = ({
  profiles,
  activeProfile,
  controller,
  pad,
  active,
  hudMatch,
  hudScores,
  keyLabels,
  listeningId,
  onRequestBind,
  onCancelBind,
  onSelectProfile,
  onUpdateController,
  onSaveProfile,
}) => {
  const [view, setView] = useState<"visual" | "list" | "hud">("visual");
  const [selectedLayer, setSelectedLayer] = useState<number | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<Target>("Cross");
  const [filter, setFilter] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Guided Custom Binding Builder state
  const [addingCustom, setAddingCustom] = useState(false);
  const [customLabel, setCustomLabel] = useState("");
  const [customKey, setCustomKey] = useState("");
  const [customTarget, setCustomTarget] = useState<Target>("Cross");
  const [customMode, setCustomMode] = useState<BindMode>("Hold");
  const [customSwitch, setCustomSwitch] = useState<string>("");

  // HUD capture countdown state
  const [capturingId, setCapturingId] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number>(0);
  const [hudError, setHudError] = useState<string | null>(null);

  useEffect(() => {
    if (!capturingId || countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [capturingId, countdown]);

  const currentBindings: Binding[] =
    selectedLayer === null
      ? activeProfile.bindings
      : activeProfile.layers[selectedLayer]?.bindings ?? [];

  const updateBindings = (next: Binding[]) => {
    if (selectedLayer === null) {
      onSaveProfile({ ...activeProfile, bindings: next });
    } else {
      const layers = activeProfile.layers.map((l, idx) =>
        idx === selectedLayer ? { ...l, bindings: next } : l
      );
      onSaveProfile({ ...activeProfile, layers });
    }
  };

  const keysForTarget = (t: Target) =>
    currentBindings
      .map((b, i) => ({ ...b, index: i }))
      .filter((b) => b.target === t);

  const rebindTargetPrimary = (t: Target) => {
    const lid = `map-rebind-${selectedLayer ?? "base"}-${t}`;
    if (listeningId === lid) {
      onCancelBind();
      return;
    }
    onRequestBind(lid, (source) => {
      const idx = currentBindings.findIndex((b) => b.target === t);
      const next =
        idx >= 0
          ? currentBindings.map((b, i) => (i === idx ? { ...b, source } : b))
          : [
              ...currentBindings,
              {
                source,
                target: t,
                mode: "Hold" as const,
                label: targetLabel(t, controller),
                switch_layer: null,
              },
            ];
      updateBindings(next);
    });
  };

  const addSecondaryForTarget = (t: Target) => {
    const lid = `map-add-${selectedLayer ?? "base"}-${t}-${Date.now()}`;
    onRequestBind(lid, (source) => {
      updateBindings([
        ...currentBindings,
        {
          source,
          target: t,
          mode: "Hold",
          label: targetLabel(t, controller),
          switch_layer: null,
        },
      ]);
    });
  };

  const updateBindingAt = (index: number, patch: Partial<Binding>) => {
    const next = currentBindings.map((b, i) => (i === index ? { ...b, ...patch } : b));
    updateBindings(next);
  };

  const removeAt = (index: number) => {
    updateBindings(currentBindings.filter((_, i) => i !== index));
  };

  const submitCustomBinding = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customKey) return;
    const entry: Binding = {
      source: customKey,
      target: customTarget,
      mode: customMode,
      label: customLabel.trim() || targetLabel(customTarget, controller),
      switch_layer: customSwitch || null,
    };
    updateBindings([...currentBindings, entry]);
    setCustomLabel("");
    setCustomKey("");
    setCustomSwitch("");
    setAddingCustom(false);
  };

  const addLayer = () => {
    const layer: Layer = {
      name: `Layer ${activeProfile.layers.length + 1}`,
      activator: "V",
      mode: "Toggle",
      aim_multiplier: null,
      aim_target: null,
      hud: { zone: "BottomRight", samples: [] },
      bindings: [],
    };
    const nextLayers = [...activeProfile.layers, layer];
    onSaveProfile({ ...activeProfile, layers: nextLayers });
    setSelectedLayer(nextLayers.length - 1);
  };

  const updateLayer = (idx: number, patch: Partial<Layer>) => {
    const layers = activeProfile.layers.map((l, i) => (i === idx ? { ...l, ...patch } : l));
    onSaveProfile({ ...activeProfile, layers });
  };

  const deleteLayer = (idx: number) => {
    const layers = activeProfile.layers.filter((_, i) => i !== idx);
    onSaveProfile({ ...activeProfile, layers });
    setSelectedLayer(null);
  };

  const captureForRule = async (
    id: string,
    zone: HudZone,
    onCaptured: (sample: HudSample) => void
  ) => {
    setHudError(null);
    setCapturingId(id);
    setCountdown(3);
    try {
      const sample = await invoke<HudSample>("capture_hud_sample", {
        zone,
        delayMs: 3000,
      });
      onCaptured(sample);
    } catch (err) {
      setHudError(String(err));
    } finally {
      setCapturingId(null);
      setCountdown(0);
    }
  };

  const updateBaseHud = (patch: Partial<HudRule>) => {
    onSaveProfile({
      ...activeProfile,
      hud: { ...activeProfile.hud, base_rule: { ...activeProfile.hud.base_rule, ...patch } },
    });
  };

  const updateLayerHud = (idx: number, patch: Partial<HudRule>) => {
    const layers = activeProfile.layers.map((l, i) =>
      i === idx ? { ...l, hud: { ...l.hud, ...patch } } : l
    );
    onSaveProfile({ ...activeProfile, layers });
  };

  const grouped = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return GROUPS.map((group) => {
      const items = currentBindings
        .map((binding, index) => ({ binding, index }))
        .filter(({ binding }) => TARGET_META[binding.target].group === group)
        .filter(({ binding }) => {
          if (!q) return true;
          const tLabel = targetLabel(binding.target, controller).toLowerCase();
          const kLabel = formatKey(binding.source, keyLabels).toLowerCase();
          const aLabel = (binding.label || "").toLowerCase();
          return tLabel.includes(q) || kLabel.includes(q) || aLabel.includes(q);
        });
      return { group, items };
    });
  }, [currentBindings, filter, controller, keyLabels]);

  const renderCallout = (t: Target) => {
    const bound = keysForTarget(t);
    const keyStr =
      bound.length > 0
        ? bound.map((b) => formatKey(b.source, keyLabels)).join(" / ")
        : "";
    const isSelected = selectedTarget === t;
    const isLive = isTargetPressed(t, pad);

    return (
      <button
        key={t}
        className={`callout ${isSelected ? "selected" : ""} ${isLive ? "active-live" : ""}`}
        onClick={() => setSelectedTarget(t)}
        onDoubleClick={() => rebindTargetPrimary(t)}
        title="Click to inspect, double-click to rebind"
      >
        <span className="callout-name">{targetLabel(t, controller)}</span>
        <span className={`callout-key ${keyStr ? "" : "empty"}`}>
          {keyStr || "Not set"}
        </span>
      </button>
    );
  };

  const selectedList = keysForTarget(selectedTarget);
  const rebindLid = `map-rebind-${selectedLayer ?? "base"}-${selectedTarget}`;

  const switchOptions = [
    { value: "", label: "No layer switch" },
    { value: "__prev__", label: "Return to previous layer" },
    { value: "__base__", label: activeProfile.id === "gta6" ? "Base (PS5 Menu)" : "Base" },
    ...activeProfile.layers.map((l) => ({ value: l.name, label: `Switch to ${l.name}` })),
  ];

  const renderHudCard = (
    id: string,
    title: string,
    badge: string,
    rule: HudRule,
    score: number | undefined,
    onChangeRule: (patch: Partial<HudRule>) => void
  ) => {
    const isMatched = hudMatch === (id === "base" ? "Base" : title);
    const isCapturing = capturingId === id;
    const pct = score !== undefined ? Math.round(score * 100) : null;

    return (
      <div
        key={id}
        className="card"
        style={{
          borderColor: isMatched ? "var(--green)" : undefined,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{title}</span>
            <span className="kbd" style={{ fontSize: 11 }}>{badge}</span>
          </div>
          {isMatched ? (
            <span className="tag tag-green">Matched {pct}%</span>
          ) : pct !== null ? (
            <span className="tag tag-muted">{pct}% match</span>
          ) : (
            <span className="tag tag-muted">{rule.samples.length} samples</span>
          )}
        </div>

        <div className="field">
          <span className="field-hint">Screen area to watch</span>
          <select
            className="select"
            style={{ padding: "5px 9px", fontSize: 12 }}
            value={rule.zone}
            onChange={(e) => onChangeRule({ zone: e.target.value as HudZone })}
          >
            {HUD_ZONES.map((z) => (
              <option key={z.id} value={z.id}>
                {z.label} — {z.hint}
              </option>
            ))}
          </select>
        </div>

        {pct !== null && (
          <div style={{ height: 4, borderRadius: 99, background: "var(--bg-card-inner)", overflow: "hidden" }}>
            <div
              style={{
                width: `${pct}%`,
                height: "100%",
                background: isMatched ? "var(--green)" : "var(--accent)",
                transition: "width 0.18s",
              }}
            />
          </div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", minHeight: 42 }}>
          {rule.samples.length === 0 ? (
            <span className="field-hint">No HUD snapshots captured yet.</span>
          ) : (
            rule.samples.map((s, si) => (
              <div key={si} style={{ position: "relative" }}>
                <HudPatchPreview rgb={s.rgb} />
                <button
                  onClick={() =>
                    onChangeRule({ samples: rule.samples.filter((_, idx) => idx !== si) })
                  }
                  title="Remove sample"
                  style={{
                    position: "absolute",
                    top: -6,
                    right: -6,
                    width: 16,
                    height: 16,
                    borderRadius: 99,
                    border: "1px solid var(--border-strong)",
                    background: "var(--bg-card)",
                    color: "var(--text)",
                    fontSize: 10,
                    lineHeight: "14px",
                    cursor: "pointer",
                  }}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
          <button
            className="btn btn-sm btn-primary"
            disabled={capturingId !== null}
            onClick={() =>
              captureForRule(id, rule.zone, (sample) => {
                const nextSamples = [...rule.samples.slice(-3), sample];
                onChangeRule({ samples: nextSamples });
              })
            }
          >
            {isCapturing ? `Switch to game… ${countdown}s` : "Capture HUD (3s)"}
          </button>
          {rule.samples.length > 0 && (
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => onChangeRule({ samples: [] })}
            >
              Clear
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Mapping</div>
          <div className="page-sub">
            Click controls to remap, add named custom bindings, or configure HUD Auto-Detect.
          </div>
        </div>

        <div className="seg">
          <button
            className={`seg-btn ${view === "visual" ? "active" : ""}`}
            onClick={() => setView("visual")}
          >
            Visual Map
          </button>
          <button
            className={`seg-btn ${view === "list" ? "active" : ""}`}
            onClick={() => setView("list")}
          >
            All Bindings
          </button>
          <button
            className={`seg-btn ${view === "hud" ? "active" : ""}`}
            onClick={() => setView("hud")}
          >
            HUD Auto-Detect
          </button>
        </div>
      </div>

      {/* Inline Studio Bar */}
      <div
        className="card"
        style={{
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <select
            className="select"
            style={{
              padding: "5px 10px",
              fontSize: 12.5,
              fontWeight: 600,
              background: "var(--accent)",
              borderColor: "transparent",
            }}
            value={activeProfile.id}
            onChange={(e) => {
              onSelectProfile(e.target.value);
              setSelectedLayer(null);
            }}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id} style={{ background: "#181622", color: "#fff" }}>
                {p.name}
              </option>
            ))}
          </select>

          {view !== "hud" && (
            <>
              <button
                className={`pill ${selectedLayer === null ? "active" : ""}`}
                onClick={() => setSelectedLayer(null)}
              >
                {activeProfile.id === "gta6" ? "Base (PS5 Menu)" : "Base"}
              </button>
              {activeProfile.layers.map((l, idx) => (
                <button
                  key={idx}
                  className={`pill ${selectedLayer === idx ? "active" : ""}`}
                  onClick={() => setSelectedLayer(idx)}
                >
                  {l.name} ({formatKey(l.activator, keyLabels)})
                </button>
              ))}
              <button className="btn btn-sm btn-ghost" onClick={addLayer}>
                + Layer
              </button>
            </>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {view !== "hud" && (
            <button
              className="btn btn-sm btn-primary"
              onClick={() => setAddingCustom((v) => !v)}
            >
              + Add Custom Binding
            </button>
          )}
          <div className="seg">
            <button
              className={`seg-btn ${controller === "DualShock4" ? "active" : ""}`}
              onClick={() => onUpdateController("DualShock4")}
            >
              PS5
            </button>
            <button
              className={`seg-btn ${controller === "Xbox360" ? "active" : ""}`}
              onClick={() => onUpdateController("Xbox360")}
            >
              Xbox
            </button>
          </div>
        </div>
      </div>

      {/* Guided Custom Binding Builder */}
      {addingCustom && view !== "hud" && (
        <form
          className="card"
          onSubmit={submitCustomBinding}
          style={{ display: "flex", flexDirection: "column", gap: 12, borderColor: "var(--accent-border)" }}
        >
          <div className="card-title" style={{ marginBottom: 0 }}>
            <span>
              Add Custom Binding{" "}
              <span className="card-title-muted">
                · Saves to{" "}
                {selectedLayer === null
                  ? activeProfile.id === "gta6"
                    ? "Base (PS5 Menu)"
                    : "Base"
                  : activeProfile.layers[selectedLayer]?.name}
              </span>
            </span>
          </div>

          <div className="grid-2" style={{ gap: 12 }}>
            <div className="field">
              <span className="field-label">1. Action Name</span>
              <input
                className="input"
                placeholder="e.g. Cruise Throttle, Open Phone, Screenshot"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
              />
            </div>

            <div className="field">
              <span className="field-label">2. Keyboard Key or Mouse Button</span>
              <button
                type="button"
                className={`kbd kbd-btn ${listeningId === "custom-builder-key" ? "listening" : ""}`}
                style={{ padding: "7px 12px", justifyContent: "flex-start" }}
                onClick={() =>
                  listeningId === "custom-builder-key"
                    ? onCancelBind()
                    : onRequestBind("custom-builder-key", (k) => setCustomKey(k))
                }
              >
                {listeningId === "custom-builder-key"
                  ? "Press any key or mouse button…"
                  : customKey
                  ? formatKey(customKey, keyLabels)
                  : "Click to choose key…"}
              </button>
            </div>

            <div className="field">
              <span className="field-label">3. Controller Output</span>
              <select
                className="select"
                value={customTarget}
                onChange={(e) => setCustomTarget(e.target.value as Target)}
              >
                {GROUPS.map((g) => (
                  <optgroup key={g} label={g}>
                    {ALL_TARGETS.filter((t) => TARGET_META[t].group === g).map((t) => (
                      <option key={t} value={t}>
                        {targetLabel(t, controller)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            <div className="field">
              <span className="field-label">4. Mode &amp; Optional Layer Switch</span>
              <div style={{ display: "flex", gap: 8 }}>
                <select
                  className="select"
                  style={{ width: 96 }}
                  value={customMode}
                  onChange={(e) => setCustomMode(e.target.value as BindMode)}
                >
                  <option value="Hold">Hold</option>
                  <option value="Toggle">Toggle</option>
                </select>
                <select
                  className="select"
                  style={{ flex: 1 }}
                  value={customSwitch}
                  onChange={(e) => setCustomSwitch(e.target.value)}
                >
                  {switchOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAddingCustom(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-sm btn-primary" disabled={!customKey}>
              Add Binding
            </button>
          </div>
        </form>
      )}

      {/* Inline Layer Editor when a Layer tab is active */}
      {view !== "hud" && selectedLayer !== null && activeProfile.layers[selectedLayer] && (
        <div
          className="card"
          style={{
            padding: 12,
            display: "grid",
            gridTemplateColumns: "1fr auto auto auto auto auto",
            gap: 10,
            alignItems: "center",
          }}
        >
          <input
            className="input"
            value={activeProfile.layers[selectedLayer].name}
            onChange={(e) => updateLayer(selectedLayer, { name: e.target.value })}
            placeholder="Layer name"
          />
          <button
            className={`kbd kbd-btn ${listeningId === `layer-${selectedLayer}` ? "listening" : ""}`}
            onClick={() =>
              listeningId === `layer-${selectedLayer}`
                ? onCancelBind()
                : onRequestBind(`layer-${selectedLayer}`, (k) =>
                    updateLayer(selectedLayer, { activator: k })
                  )
            }
          >
            {listeningId === `layer-${selectedLayer}`
              ? "Press key..."
              : `Key: ${formatKey(activeProfile.layers[selectedLayer].activator, keyLabels)}`}
          </button>
          <button
            className="btn btn-sm"
            onClick={() =>
              updateLayer(selectedLayer, {
                mode: activeProfile.layers[selectedLayer].mode === "Hold" ? "Toggle" : "Hold",
              })
            }
          >
            {activeProfile.layers[selectedLayer].mode}
          </button>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-dim)" }}>
            Aim ×
            <input
              className="input"
              type="number"
              step="0.05"
              min="0.1"
              max="3"
              style={{ width: 64, padding: "4px 6px" }}
              value={activeProfile.layers[selectedLayer].aim_multiplier ?? ""}
              placeholder="1.0"
              onChange={(e) =>
                updateLayer(selectedLayer, {
                  aim_multiplier: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </label>
          <select
            className="select"
            style={{ padding: "4px 8px", fontSize: 12 }}
            value={activeProfile.layers[selectedLayer].aim_target ?? ""}
            onChange={(e) =>
              updateLayer(selectedLayer, {
                aim_target: e.target.value === "" ? null : (e.target.value as AimTarget),
              })
            }
            title="Mouse Stick for this layer"
          >
            <option value="">Mouse: Default</option>
            <option value="RightStick">Mouse: Right Stick</option>
            <option value="LeftStick">Mouse: Left Stick</option>
            <option value="Off">Mouse: Off</option>
          </select>
          <button className="btn btn-sm btn-danger" onClick={() => deleteLayer(selectedLayer)}>
            Remove
          </button>
        </div>
      )}

      {/* VIEW 1: VISUAL MAP */}
      {view === "visual" && (
        <>
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="callout-row">{TOP_TARGETS.map(renderCallout)}</div>

            <div className="mapping-stage">
              <div className="callout-col">{LEFT_TARGETS.map(renderCallout)}</div>

              <ControllerSvg
                pad={pad}
                controller={controller}
                active={active}
                bindings={currentBindings}
                keyLabels={keyLabels}
                selectedTarget={selectedTarget}
                listeningTarget={listeningId === rebindLid ? selectedTarget : null}
                compact
                onClickTarget={(t) => setSelectedTarget(t)}
              />

              <div className="callout-col">{RIGHT_TARGETS.map(renderCallout)}</div>
            </div>

            <div className="callout-row">{BOTTOM_TARGETS.map(renderCallout)}</div>
          </div>

          {/* Selected Control Inspector (clear rows for each bound key) */}
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: 14 }}>
                  {targetLabel(selectedTarget, controller)}
                </span>
                <span className="field-hint" style={{ marginLeft: 8 }}>
                  {selectedList.length} key{selectedList.length === 1 ? "" : "s"} bound
                </span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className={`btn btn-sm ${listeningId === rebindLid ? "btn-primary" : ""}`}
                  onClick={() => rebindTargetPrimary(selectedTarget)}
                >
                  {listeningId === rebindLid ? "Press key…" : "Quick Rebind"}
                </button>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => addSecondaryForTarget(selectedTarget)}
                >
                  + Add Extra Key
                </button>
              </div>
            </div>

            {selectedList.length === 0 ? (
              <div className="field-hint">
                No keys bound to {targetLabel(selectedTarget, controller)} in this layer.
              </div>
            ) : (
              <div className="bind-list">
                {selectedList.map((b) => {
                  const rowLid = `insp-${b.index}`;
                  const isL = listeningId === rowLid;
                  return (
                    <div
                      key={b.index}
                      className="bind-row"
                      style={{ gridTemplateColumns: "1fr auto auto auto auto" }}
                    >
                      <input
                        className="input"
                        style={{ padding: "4px 8px", fontSize: 12 }}
                        placeholder={targetLabel(b.target, controller)}
                        value={b.label}
                        onChange={(e) => updateBindingAt(b.index, { label: e.target.value })}
                      />
                      <button
                        className={`kbd kbd-btn ${isL ? "listening" : ""}`}
                        onClick={() =>
                          isL
                            ? onCancelBind()
                            : onRequestBind(rowLid, (src) => updateBindingAt(b.index, { source: src }))
                        }
                      >
                        {isL ? "Press key…" : formatKey(b.source, keyLabels)}
                      </button>
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() =>
                          updateBindingAt(b.index, { mode: b.mode === "Hold" ? "Toggle" : "Hold" })
                        }
                      >
                        {b.mode}
                      </button>
                      <select
                        className="select"
                        style={{ padding: "4px 8px", fontSize: 11.5 }}
                        value={b.switch_layer ?? ""}
                        onChange={(e) =>
                          updateBindingAt(b.index, { switch_layer: e.target.value || null })
                        }
                      >
                        {switchOptions.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <button
                        className="btn btn-sm btn-ghost"
                        style={{ color: "var(--text-muted)", padding: "4px 8px" }}
                        onClick={() => removeAt(b.index)}
                        title="Remove"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* VIEW 2: ALL BINDINGS */}
      {view === "list" && (
        <>
          <div
            className="card"
            style={{
              padding: "10px 14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <span className="field-hint">
              Click any keycap to rebind, or use <strong>+ Add Custom Binding</strong> above to add named keys or layer triggers.
            </span>
            <input
              className="input"
              style={{ width: 220, padding: "5px 10px", fontSize: 12.5 }}
              placeholder="Search action, button, or key…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>

          <div className="grid-2">
            {grouped.map(({ group, items }) => (
              <div className="card" key={group}>
                <div className="card-title">
                  <span>{group}</span>
                  <span className="card-title-muted">{items.length}</span>
                </div>
                {items.length === 0 ? (
                  <div className="field-hint" style={{ padding: "6px 0" }}>
                    No bindings{selectedLayer !== null ? " in this layer (inherits Base)" : ""}.
                  </div>
                ) : (
                  <div className="bind-list">
                    {items.map(({ binding, index }) => {
                      const lid = `bind-${selectedLayer ?? "base"}-${index}`;
                      const isListening = listeningId === lid;
                      return (
                        <div className="bind-row" key={`${binding.target}-${binding.source}-${index}`}>
                          <div style={{ display: "flex", flexDirection: "column" }}>
                            <span style={{ fontWeight: 600 }}>
                              {binding.label || targetLabel(binding.target, controller)}
                            </span>
                            <span className="field-hint" style={{ fontSize: 11 }}>
                              {targetLabel(binding.target, controller)}
                              {binding.switch_layer ? ` · ${switchLayerLabel(binding.switch_layer)}` : ""}
                            </span>
                          </div>
                          <button
                            className={`kbd kbd-btn ${isListening ? "listening" : ""}`}
                            onClick={() =>
                              isListening
                                ? onCancelBind()
                                : onRequestBind(lid, (source) =>
                                    updateBindingAt(index, { source })
                                  )
                            }
                          >
                            {isListening ? "Press key..." : formatKey(binding.source, keyLabels)}
                          </button>
                          <button
                            className="btn btn-sm btn-ghost"
                            style={{ minWidth: 54 }}
                            onClick={() =>
                              updateBindingAt(index, {
                                mode: binding.mode === "Hold" ? "Toggle" : "Hold",
                              })
                            }
                          >
                            {binding.mode}
                          </button>
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => removeAt(index)}
                            style={{ color: "var(--text-muted)", padding: "4px 8px" }}
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* VIEW 3: HUD AUTO-DETECT */}
      {view === "hud" && (
        <>
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 700 }}>Stream HUD Auto-Detect</div>
                <div className="field-hint">
                  Reads tiny HUD corners from your focused Remote Play / Veyra / PushFPS window (~4×/sec, 0 ms input lag) to switch layers automatically.
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span className={`tag ${activeProfile.hud.enabled ? (hudMatch ? "tag-green" : "tag-accent") : "tag-muted"}`}>
                  {!activeProfile.hud.enabled
                    ? "Disabled"
                    : hudMatch
                    ? `Detected: ${hudMatch}`
                    : "Scanning…"}
                </span>
                <button
                  className={`switch ${activeProfile.hud.enabled ? "on" : ""}`}
                  onClick={() =>
                    onSaveProfile({
                      ...activeProfile,
                      hud: { ...activeProfile.hud, enabled: !activeProfile.hud.enabled },
                    })
                  }
                />
              </div>
            </div>

            <div className="slider-row" style={{ paddingTop: 6, borderTop: "1px solid var(--border)" }}>
              <div className="slider-head">
                <span className="field-label">Match Sensitivity Threshold</span>
                <span className="slider-val">{Math.round(activeProfile.hud.threshold * 100)}%</span>
              </div>
              <input
                type="range"
                min={0.62}
                max={0.92}
                step={0.01}
                value={activeProfile.hud.threshold}
                onChange={(e) =>
                  onSaveProfile({
                    ...activeProfile,
                    hud: { ...activeProfile.hud, threshold: Number(e.target.value) },
                  })
                }
              />
              <span className="field-hint">
                How closely the live HUD must match a captured snapshot before switching (lower if day/night lighting varies; capture 2–3 samples per mode for best results).
              </span>
            </div>

            {hudError && (
              <div className="banner banner-warn">
                <span>{hudError}</span>
              </div>
            )}
          </div>

          <div className="grid-2">
            {renderHudCard(
              "base",
              activeProfile.id === "gta6" ? "Base (PS5 Menu)" : "Base",
              "Default",
              activeProfile.hud.base_rule,
              hudScores.find(([n]) => n === "Base")?.[1],
              updateBaseHud
            )}
            {activeProfile.layers.map((l, idx) =>
              renderHudCard(
                `layer-${idx}`,
                l.name,
                formatKey(l.activator, keyLabels),
                l.hud,
                hudScores.find(([n]) => n === l.name)?.[1],
                (patch) => updateLayerHud(idx, patch)
              )
            )}
          </div>
        </>
      )}

      {/* Collapsible Advanced Movement Drawer */}
      {view !== "hud" && (
        <div className="drawer">
          <button className="drawer-toggle" onClick={() => setShowAdvanced((v) => !v)}>
            <span>
              Advanced Movement{" "}
              <span className="card-title-muted" style={{ marginLeft: 8 }}>
                Walk scale, trigger feathering, SOCD &amp; scroll pulse
              </span>
            </span>
            <span className={`drawer-chevron ${showAdvanced ? "open" : ""}`}>▾</span>
          </button>

          {showAdvanced && (
            <div className="drawer-body">
              <div className="grid-2" style={{ gap: 16 }}>
                <div className="slider-row">
                  <div className="slider-head">
                    <span className="field-label">Walk Scale</span>
                    <span className="slider-val">{Math.round(activeProfile.movement.walk_scale * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0.15}
                    max={0.85}
                    step={0.05}
                    value={activeProfile.movement.walk_scale}
                    onChange={(e) =>
                      onSaveProfile({
                        ...activeProfile,
                        movement: { ...activeProfile.movement, walk_scale: Number(e.target.value) },
                      })
                    }
                  />
                </div>

                <div className="slider-row">
                  <div className="slider-head">
                    <span className="field-label">Trigger Feather Scale</span>
                    <span className="slider-val">{Math.round(activeProfile.movement.feather_scale * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0.15}
                    max={0.85}
                    step={0.05}
                    value={activeProfile.movement.feather_scale}
                    onChange={(e) =>
                      onSaveProfile({
                        ...activeProfile,
                        movement: { ...activeProfile.movement, feather_scale: Number(e.target.value) },
                      })
                    }
                  />
                </div>

                <div className="field">
                  <span className="field-label">Opposite Directions (SOCD)</span>
                  <div className="seg" style={{ width: "100%" }}>
                    {(
                      [
                        ["LastWins", "Last Input Wins"],
                        ["Neutral", "Neutral (0)"],
                      ] as [Socd, string][]
                    ).map(([v, label]) => (
                      <button
                        key={v}
                        className={`seg-btn ${activeProfile.movement.socd === v ? "active" : ""}`}
                        style={{ flex: 1 }}
                        onClick={() =>
                          onSaveProfile({
                            ...activeProfile,
                            movement: { ...activeProfile.movement, socd: v },
                          })
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="slider-row">
                  <div className="slider-head">
                    <span className="field-label">Scroll Wheel Pulse</span>
                    <span className="slider-val">{Math.round(activeProfile.movement.wheel_pulse_ms)} ms</span>
                  </div>
                  <input
                    type="range"
                    min={15}
                    max={120}
                    step={5}
                    value={activeProfile.movement.wheel_pulse_ms}
                    onChange={(e) =>
                      onSaveProfile({
                        ...activeProfile,
                        movement: { ...activeProfile.movement, wheel_pulse_ms: Number(e.target.value) },
                      })
                    }
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
};
