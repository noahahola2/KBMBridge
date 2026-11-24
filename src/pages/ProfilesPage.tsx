import React, { useState } from "react";
import { Profile } from "../types";

interface Props {
  profiles: Profile[];
  activeId: string;
  onSelectProfile: (id: string) => void;
  onCreateProfile: (name: string, game: string) => void;
  onSaveProfile: (p: Profile) => void;
  onDeleteProfile: (id: string) => void;
  onEditMapping: (id: string) => void;
}

export const ProfilesPage: React.FC<Props> = ({
  profiles,
  activeId,
  onSelectProfile,
  onCreateProfile,
  onSaveProfile,
  onDeleteProfile,
  onEditMapping,
}) => {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [game, setGame] = useState("");
  const [search, setSearch] = useState("");

  const filtered = profiles.filter((p) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return p.name.toLowerCase().includes(q) || p.game.toLowerCase().includes(q);
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onCreateProfile(name.trim(), game.trim());
    setName("");
    setGame("");
    setCreating(false);
  };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Profiles</div>
          <div className="page-sub">Per-game bindings, layers, and mouse curves.</div>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating((v) => !v)}>
          + New profile
        </button>
      </div>

      {creating && (
        <form
          className="card"
          onSubmit={handleCreate}
          style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}
        >
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <span className="field-label">Profile Name</span>
            <input
              className="input"
              placeholder="e.g. Call of Duty"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <span className="field-label">Game Title (optional)</span>
            <input
              className="input"
              placeholder="e.g. Black Ops"
              value={game}
              onChange={(e) => setGame(e.target.value)}
            />
          </div>
          <button className="btn btn-primary" type="submit">
            Create
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => setCreating(false)}>
            Cancel
          </button>
        </form>
      )}

      <input
        className="input"
        placeholder="Search profiles..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="grid-2">
        {filtered.map((p) => {
          const active = p.id === activeId;
          return (
            <div
              key={p.id}
              className="card"
              style={{
                borderColor: active ? "var(--accent)" : undefined,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{p.name}</div>
                  <div className="field-hint">{p.game || "Custom profile"}</div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {p.builtin && <span className="tag tag-muted">Built-in</span>}
                  {active && <span className="tag tag-green">Active</span>}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span className="tag tag-accent">{p.bindings.length} bindings</span>
                <span className="tag tag-muted">{p.layers.length} layers</span>
                <span className="tag tag-muted">
                  Sens {p.aim.use_cm360 ? `${p.aim.cm_per_360}cm` : p.aim.sensitivity.toFixed(1)}
                </span>
              </div>

              <div className="field">
                <span className="field-hint">Auto-switch executable (optional)</span>
                <input
                  className="input"
                  style={{ padding: "5px 9px", fontSize: 12 }}
                  placeholder="e.g. GTA6.exe;Veyra.exe"
                  value={p.auto_switch_app}
                  onChange={(e) => onSaveProfile({ ...p, auto_switch_app: e.target.value })}
                />
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
                {!active && (
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => onSelectProfile(p.id)}
                  >
                    Activate
                  </button>
                )}
                <button
                  className="btn btn-sm"
                  onClick={() => onEditMapping(p.id)}
                >
                  Edit mapping
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  style={{ marginLeft: "auto" }}
                  onClick={() => onDeleteProfile(p.id)}
                >
                  {p.id === "gta6" ? "Reset defaults" : "Delete"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
};
