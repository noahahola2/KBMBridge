export type Target =
  | "Cross"
  | "Circle"
  | "Square"
  | "Triangle"
  | "L1"
  | "R1"
  | "L2"
  | "R2"
  | "L3"
  | "R3"
  | "Share"
  | "Options"
  | "PS"
  | "Touchpad"
  | "DpadUp"
  | "DpadDown"
  | "DpadLeft"
  | "DpadRight"
  | "LsUp"
  | "LsDown"
  | "LsLeft"
  | "LsRight"
  | "RsUp"
  | "RsDown"
  | "RsLeft"
  | "RsRight"
  | "Walk"
  | "Feather";

export type BindMode = "Hold" | "Toggle";
export type AimTarget = "RightStick" | "LeftStick" | "Off";
export type DeadzoneShape = "Radial" | "Axial";
export type CurveMode = "Exponent" | "Custom";
export type Socd = "LastWins" | "Neutral";
export type ControllerType = "DualShock4" | "Xbox360";
export type Connection = "RemotePlay" | "CaptureCard";
export type ConsoleSource = "Ps5Streaming" | "XboxStreaming" | "CaptureCard";
export type CompanionMode =
  | "ControllerOnly"
  | "Veyra"
  | "PushFPS"
  | "RemotePlayClient"
  | "Custom";

export type HudZone =
  | "BottomRight"
  | "BottomLeft"
  | "TopBar"
  | "TopLeft"
  | "TopRight"
  | "Center";

export interface HudSample {
  rgb: number[];
}

export interface HudRule {
  zone: HudZone;
  samples: HudSample[];
}

export interface HudConfig {
  enabled: boolean;
  threshold: number;
  base_rule: HudRule;
}

export const HUD_ZONES: { id: HudZone; label: string; hint: string }[] = [
  { id: "TopBar", label: "Top Bar", hint: "PS5 Home / System header" },
  { id: "TopLeft", label: "Top-Left", hint: "Pause menu header / tabs" },
  { id: "TopRight", label: "Top-Right", hint: "Weapon / money / wanted HUD" },
  { id: "BottomLeft", label: "Bottom-Left", hint: "Minimap / radar / map legend" },
  { id: "BottomRight", label: "Bottom-Right", hint: "Speedometer / altimeter / prompts" },
  { id: "Center", label: "Center", hint: "Center reticle / overlay" },
];

export interface Binding {
  source: string;
  target: Target;
  mode: BindMode;
  label: string;
  switch_layer: string | null;
}

export interface Layer {
  name: string;
  activator: string;
  mode: BindMode;
  aim_multiplier: number | null;
  aim_target: AimTarget | null;
  hud: HudRule;
  bindings: Binding[];
}

export interface AimSettings {
  target: AimTarget;
  sensitivity: number;
  use_cm360: boolean;
  mouse_dpi: number;
  cm_per_360: number;
  max_turn_dps: number;
  y_ratio: number;
  invert_y: boolean;
  ads_multiplier: number;
  curve_mode: CurveMode;
  exponent: number;
  curve_points: [number, number][];
  anti_deadzone: number;
  deadzone_shape: DeadzoneShape;
  boost: number;
  smoothing_ms: number;
  overflow_ms: number;
  dithering: boolean;
  max_output: number;
}

export interface MovementSettings {
  walk_scale: number;
  feather_scale: number;
  socd: Socd;
  wheel_pulse_ms: number;
}

export interface Profile {
  id: string;
  name: string;
  game: string;
  auto_switch_app: string;
  builtin: boolean;
  aim: AimSettings;
  movement: MovementSettings;
  bindings: Binding[];
  layers: Layer[];
  hud: HudConfig;
}

export interface Settings {
  setup_completed: boolean;
  console_source: ConsoleSource;
  controller: ControllerType;
  connection: Connection;
  companion: CompanionMode;
  video_app: string;
  auto_focus: boolean;
  toggle_key: string;
  hold_release_key: string;
  output_hz: number;
  lock_cursor: boolean;
  block_input: boolean;
  high_priority: boolean;
  active_profile: string;
}

export interface PadState {
  buttons: number;
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  l2: number;
  r2: number;
}

export interface Snapshot {
  pad: PadState;
  active: boolean;
  armed: boolean;
  temp_released: boolean;
  focus_ok: boolean;
  connected: boolean;
  driver_error: string | null;
  controller: ControllerType;
  key_latency_us: number;
  mouse_latency_us: number;
  mouse_hz: number;
  submit_hz: number;
  tick_hz: number;
  layers: string[];
  foreground: string;
  profile: string;
  hud_match: string | null;
  hud_scores: [string, number][];
}

export interface Bootstrap {
  settings: Settings;
  profiles: Profile[];
  key_labels: Record<string, string>;
}

export interface AppWindow {
  exe: string;
  title: string;
}

export const EMPTY_PAD: PadState = {
  buttons: 0,
  lx: 0,
  ly: 0,
  rx: 0,
  ry: 0,
  l2: 0,
  r2: 0,
};

export const EMPTY_SNAPSHOT: Snapshot = {
  pad: EMPTY_PAD,
  active: false,
  armed: false,
  temp_released: false,
  focus_ok: true,
  connected: false,
  driver_error: null,
  controller: "DualShock4",
  key_latency_us: 0,
  mouse_latency_us: 0,
  mouse_hz: 1000,
  submit_hz: 0,
  tick_hz: 0,
  layers: [],
  foreground: "",
  profile: "GTA VI",
  hud_match: null,
  hud_scores: [],
};

export const TARGET_META: Record<
  Target,
  {
    ps: string;
    xbox: string;
    group: "Movement" | "Triggers & Bumpers" | "Face & Sticks" | "D-Pad & System";
  }
> = {
  LsUp: { ps: "Left Stick Up", xbox: "Left Stick Up", group: "Movement" },
  LsDown: { ps: "Left Stick Down", xbox: "Left Stick Down", group: "Movement" },
  LsLeft: { ps: "Left Stick Left", xbox: "Left Stick Left", group: "Movement" },
  LsRight: { ps: "Left Stick Right", xbox: "Left Stick Right", group: "Movement" },
  Walk: { ps: "Walk Modifier", xbox: "Walk Modifier", group: "Movement" },
  Feather: { ps: "Trigger Feather (Throttle)", xbox: "Trigger Feather (Throttle)", group: "Triggers & Bumpers" },
  RsUp: { ps: "Right Stick Up", xbox: "Right Stick Up", group: "Movement" },
  RsDown: { ps: "Right Stick Down", xbox: "Right Stick Down", group: "Movement" },
  RsLeft: { ps: "Right Stick Left", xbox: "Right Stick Left", group: "Movement" },
  RsRight: { ps: "Right Stick Right", xbox: "Right Stick Right", group: "Movement" },

  L2: { ps: "L2 Trigger", xbox: "LT Trigger", group: "Triggers & Bumpers" },
  R2: { ps: "R2 Trigger", xbox: "RT Trigger", group: "Triggers & Bumpers" },
  L1: { ps: "L1 Bumper", xbox: "LB Bumper", group: "Triggers & Bumpers" },
  R1: { ps: "R1 Bumper", xbox: "RB Bumper", group: "Triggers & Bumpers" },

  Cross: { ps: "Cross (✕)", xbox: "A Button", group: "Face & Sticks" },
  Circle: { ps: "Circle (○)", xbox: "B Button", group: "Face & Sticks" },
  Square: { ps: "Square (□)", xbox: "X Button", group: "Face & Sticks" },
  Triangle: { ps: "Triangle (△)", xbox: "Y Button", group: "Face & Sticks" },
  L3: { ps: "L3 (Stick Click)", xbox: "LS Click", group: "Face & Sticks" },
  R3: { ps: "R3 (Stick Click)", xbox: "RS Click", group: "Face & Sticks" },

  DpadUp: { ps: "D-Pad Up", xbox: "D-Pad Up", group: "D-Pad & System" },
  DpadDown: { ps: "D-Pad Down", xbox: "D-Pad Down", group: "D-Pad & System" },
  DpadLeft: { ps: "D-Pad Left", xbox: "D-Pad Left", group: "D-Pad & System" },
  DpadRight: { ps: "D-Pad Right", xbox: "D-Pad Right", group: "D-Pad & System" },
  Touchpad: { ps: "Touchpad Click", xbox: "View Button", group: "D-Pad & System" },
  Options: { ps: "Options", xbox: "Menu", group: "D-Pad & System" },
  Share: { ps: "Create / Share", xbox: "View / Share", group: "D-Pad & System" },
  PS: { ps: "PS Button", xbox: "Xbox Guide", group: "D-Pad & System" },
};

export const ALL_TARGETS = Object.keys(TARGET_META) as Target[];

export const CONSOLE_SOURCES: Record<
  ConsoleSource,
  {
    label: string;
    short: string;
    desc: string;
    defaultController: ControllerType;
    defaultConnection: Connection;
    defaultStreamExe: string;
  }
> = {
  Ps5Streaming: {
    label: "PS5 Streaming",
    short: "PS5 Remote Play",
    desc: "Stream PS5 / PS4 via Remote Play, Chiaki-ng, or Veyra with a virtual PlayStation controller.",
    defaultController: "DualShock4",
    defaultConnection: "RemotePlay",
    defaultStreamExe: "chiaki-ng.exe;chiaki.exe;RemotePlay.exe",
  },
  XboxStreaming: {
    label: "Xbox Streaming",
    short: "Xbox Remote / Cloud",
    desc: "Stream Xbox Series X|S or Cloud Gaming via the Xbox App or browser with a virtual Xbox controller.",
    defaultController: "Xbox360",
    defaultConnection: "RemotePlay",
    defaultStreamExe: "XboxPcApp.exe;msedge.exe;chrome.exe",
  },
  CaptureCard: {
    label: "Capture Card",
    short: "HDMI Capture Card",
    desc: "Low-latency capture card display (PushFPS / Veyra / OBS) paired with PS5 or Xbox virtual controller.",
    defaultController: "DualShock4",
    defaultConnection: "CaptureCard",
    defaultStreamExe: "PushFPS.exe;Veyra.exe",
  },
};

export const COMPANION_PRESETS: Record<
  CompanionMode,
  { label: string; desc: string; defaultExe: string }
> = {
  ControllerOnly: {
    label: "Controller Only",
    desc: "Virtual gamepad only — works with any focused game or stream window.",
    defaultExe: "",
  },
  Veyra: {
    label: "Veyra",
    desc: "Auto-focuses Veyra / Veyra-NRVideo AI frame-gen window.",
    defaultExe: "Veyra.exe;Veyra-NRVideo.exe",
  },
  PushFPS: {
    label: "PushFPS",
    desc: "Auto-focuses PushFPS capture-card frame-gen window.",
    defaultExe: "PushFPS.exe",
  },
  RemotePlayClient: {
    label: "Remote Play App",
    desc: "Auto-focuses Chiaki-ng, PS Remote Play, or Xbox App.",
    defaultExe: "chiaki-ng.exe;chiaki.exe;RemotePlay.exe;XboxPcApp.exe",
  },
  Custom: {
    label: "Custom App",
    desc: "Match any specific window executable on your PC.",
    defaultExe: "",
  },
};

export function targetLabel(target: Target, controller: ControllerType): string {
  return controller === "Xbox360" ? TARGET_META[target].xbox : TARGET_META[target].ps;
}

export function formatKey(name: string, labels: Record<string, string>): string {
  if (labels[name]) return labels[name];
  const map: Record<string, string> = {
    Mouse1: "LMB",
    Mouse2: "RMB",
    Mouse3: "MMB",
    Mouse4: "MB4",
    Mouse5: "MB5",
    WheelUp: "Wheel ↑",
    WheelDown: "Wheel ↓",
    LShift: "L-Shift",
    RShift: "R-Shift",
    LCtrl: "L-Ctrl",
    RCtrl: "R-Ctrl",
    LAlt: "L-Alt",
    RAlt: "R-Alt",
  };
  return map[name] ?? name;
}
