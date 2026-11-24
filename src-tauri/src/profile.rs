//! Profiles, bindings and app settings (all serialized to JSON).

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Hash)]
pub enum Target {
    Cross,
    Circle,
    Square,
    Triangle,
    L1,
    R1,
    L2,
    R2,
    L3,
    R3,
    Share,
    Options,
    PS,
    Touchpad,
    DpadUp,
    DpadDown,
    DpadLeft,
    DpadRight,
    LsUp,
    LsDown,
    LsLeft,
    LsRight,
    RsUp,
    RsDown,
    RsLeft,
    RsRight,
    /// Scales the left stick (walk / slow movement).
    Walk,
    /// Scales analog triggers L2/R2 (throttle/brake feathering).
    Feather,
}

impl Target {
    /// Bit index for digital buttons in `PadState::buttons`.
    pub fn button_bit(self) -> Option<u32> {
        use Target::*;
        Some(match self {
            Cross => 0,
            Circle => 1,
            Square => 2,
            Triangle => 3,
            L1 => 4,
            R1 => 5,
            L3 => 6,
            R3 => 7,
            Share => 8,
            Options => 9,
            PS => 10,
            Touchpad => 11,
            DpadUp => 12,
            DpadDown => 13,
            DpadLeft => 14,
            DpadRight => 15,
            _ => return None,
        })
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum BindMode {
    #[default]
    Hold,
    Toggle,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Binding {
    pub source: String,
    pub target: Target,
    #[serde(default)]
    pub mode: BindMode,
    #[serde(default)]
    pub label: String,
    /// Optional layer name (or `"__prev__"` / `"__base__"`) to switch to when pressed.
    #[serde(default)]
    pub switch_layer: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum HudZone {
    #[default]
    BottomRight,
    BottomLeft,
    TopBar,
    TopLeft,
    TopRight,
    Center,
}

impl HudZone {
    /// Normalized [x, y, width, height] inside the target window's client area.
    pub fn rect(self) -> [f32; 4] {
        match self {
            HudZone::TopBar => [0.04, 0.02, 0.45, 0.10],
            HudZone::TopLeft => [0.02, 0.02, 0.28, 0.14],
            HudZone::TopRight => [0.70, 0.02, 0.28, 0.16],
            HudZone::BottomLeft => [0.02, 0.72, 0.24, 0.24],
            HudZone::BottomRight => [0.72, 0.74, 0.25, 0.22],
            HudZone::Center => [0.35, 0.35, 0.30, 0.30],
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HudSample {
    pub rgb: Vec<u8>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct HudRule {
    pub zone: HudZone,
    pub samples: Vec<HudSample>,
}

impl Default for HudRule {
    fn default() -> Self {
        Self { zone: HudZone::BottomRight, samples: Vec::new() }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct HudConfig {
    pub enabled: bool,
    pub threshold: f32,
    pub base_rule: HudRule,
}

impl Default for HudConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            threshold: 0.78,
            base_rule: HudRule { zone: HudZone::TopBar, samples: Vec::new() },
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Layer {
    pub name: String,
    /// Key that activates the layer.
    pub activator: String,
    #[serde(default)]
    pub mode: BindMode,
    /// Optional aim sensitivity multiplier while this layer is active.
    #[serde(default)]
    pub aim_multiplier: Option<f32>,
    /// Optional mouse stick target override while this layer is active.
    #[serde(default)]
    pub aim_target: Option<AimTarget>,
    #[serde(default)]
    pub hud: HudRule,
    pub bindings: Vec<Binding>,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum AimTarget {
    #[default]
    RightStick,
    LeftStick,
    Off,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum DeadzoneShape {
    /// Games that use a circular deadzone (most modern titles incl. Rockstar).
    #[default]
    Radial,
    /// Games that apply a deadzone per axis.
    Axial,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum CurveMode {
    /// out = in ^ exponent
    #[default]
    Exponent,
    /// User-defined points, monotone cubic interpolation.
    Custom,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct AimSettings {
    pub target: AimTarget,
    /// Overall sensitivity. 10 => ~2000 counts/s = full stick.
    pub sensitivity: f32,
    /// Use DPI + cm/360 + calibrated game turn-rate instead of raw sensitivity.
    pub use_cm360: bool,
    pub mouse_dpi: u32,
    pub cm_per_360: f32,
    /// Calibrated in-game max turn speed in degrees per second (at 100% stick).
    pub max_turn_dps: f32,
    /// Vertical / horizontal ratio.
    pub y_ratio: f32,
    pub invert_y: bool,
    /// Multiplier while L2 (aim) output is held.
    pub ads_multiplier: f32,
    pub curve_mode: CurveMode,
    /// Exponent for the response curve (<1 boosts slow movement, >1 dampens it).
    pub exponent: f32,
    /// Custom curve points (x = normalized mouse speed, y = normalized stick), both 0..1.
    pub curve_points: Vec<[f32; 2]>,
    /// Game's inner deadzone to jump over (0..0.65).
    pub anti_deadzone: f32,
    pub deadzone_shape: DeadzoneShape,
    /// Initial turn kick (0..0.45) to overcome console aim-acceleration ramp.
    pub boost: f32,
    /// Velocity estimation window in milliseconds.
    pub smoothing_ms: f32,
    /// Remember movement beyond full stick and pay it out afterwards (ms of max-speed travel, 0=off).
    pub overflow_ms: f32,
    /// Temporal dithering of the quantized stick value (sub-step precision).
    pub dithering: bool,
    /// Max stick deflection produced by the mouse (0..1).
    pub max_output: f32,
}

impl Default for AimSettings {
    fn default() -> Self {
        Self {
            target: AimTarget::RightStick,
            sensitivity: 10.0,
            use_cm360: false,
            mouse_dpi: 800,
            cm_per_360: 28.0,
            max_turn_dps: 220.0,
            y_ratio: 1.0,
            invert_y: false,
            ads_multiplier: 0.72,
            curve_mode: CurveMode::Exponent,
            exponent: 0.65,
            curve_points: vec![[0.0, 0.0], [0.25, 0.36], [0.5, 0.61], [0.75, 0.82], [1.0, 1.0]],
            anti_deadzone: 0.15,
            deadzone_shape: DeadzoneShape::Radial,
            boost: 0.04,
            smoothing_ms: 4.0,
            overflow_ms: 0.0,
            dithering: true,
            max_output: 1.0,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum Socd {
    /// Most recently pressed direction wins (A+D -> whichever was pressed last).
    #[default]
    LastWins,
    Neutral,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct MovementSettings {
    pub walk_scale: f32,
    /// Trigger magnitude while holding Feather (e.g. 0.45 = 45% throttle/brake).
    pub feather_scale: f32,
    pub socd: Socd,
    /// Duration (ms) that a wheel notch holds its bound output.
    pub wheel_pulse_ms: f32,
}

impl Default for MovementSettings {
    fn default() -> Self {
        Self { walk_scale: 0.45, feather_scale: 0.55, socd: Socd::LastWins, wheel_pulse_ms: 45.0 }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Profile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub game: String,
    /// Optional executable name(s) separated by `;` to auto-switch to this profile on focus.
    #[serde(default)]
    pub auto_switch_app: String,
    #[serde(default)]
    pub builtin: bool,
    #[serde(default)]
    pub aim: AimSettings,
    #[serde(default)]
    pub movement: MovementSettings,
    pub bindings: Vec<Binding>,
    #[serde(default)]
    pub layers: Vec<Layer>,
    #[serde(default)]
    pub hud: HudConfig,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum ControllerType {
    #[default]
    DualShock4,
    Xbox360,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum Connection {
    #[default]
    RemotePlay,
    CaptureCard,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum ConsoleSource {
    #[default]
    Ps5Streaming,
    XboxStreaming,
    CaptureCard,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum CompanionMode {
    /// Controller emulation only — works with any focused window or Remote Play client.
    #[default]
    ControllerOnly,
    /// Pair with Veyra (AI frame-gen / upscaler + Remote Play / Capture Card).
    Veyra,
    /// Pair with PushFPS (Capture Card AI frame-gen).
    PushFPS,
    /// Pair with a Remote Play client (Chiaki-ng / PS Remote Play / Xbox App).
    RemotePlayClient,
    /// Custom target executable.
    Custom,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Settings {
    pub setup_completed: bool,
    pub console_source: ConsoleSource,
    pub controller: ControllerType,
    pub connection: Connection,
    pub companion: CompanionMode,
    /// Executable name(s) separated by `;` (e.g. "Veyra.exe;chiaki-ng.exe"). Empty = any window.
    pub video_app: String,
    /// Only output while the target app is focused.
    pub auto_focus: bool,
    pub toggle_key: String,
    /// While held, temporarily releases cursor & native input back to Windows.
    pub hold_release_key: String,
    pub output_hz: u32,
    pub lock_cursor: bool,
    pub block_input: bool,
    pub high_priority: bool,
    pub active_profile: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            setup_completed: false,
            console_source: ConsoleSource::Ps5Streaming,
            controller: ControllerType::DualShock4,
            connection: Connection::RemotePlay,
            companion: CompanionMode::ControllerOnly,
            video_app: String::new(),
            auto_focus: true,
            toggle_key: "F8".into(),
            hold_release_key: "RAlt".into(),
            output_hz: 1000,
            lock_cursor: true,
            block_input: true,
            high_priority: true,
            active_profile: "gta6".into(),
        }
    }
}

fn b(source: &str, target: Target) -> Binding {
    Binding { source: source.into(), target, mode: BindMode::Hold, label: String::new(), switch_layer: None }
}

fn bl(source: &str, target: Target, label: &str) -> Binding {
    Binding {
        source: source.into(),
        target,
        mode: BindMode::Hold,
        label: label.into(),
        switch_layer: None,
    }
}

fn bs(source: &str, target: Target, label: &str, switch_layer: &str) -> Binding {
    Binding {
        source: source.into(),
        target,
        mode: BindMode::Hold,
        label: label.into(),
        switch_layer: Some(switch_layer.into()),
    }
}

/// Built-in GTA VI profile:
/// - Base layer: PS5 system & dashboard navigation (arrow keys + Enter/Esc/PS)
/// - Toggle layers (mutually exclusive via F1–F5, or HUD Auto-Detect + smart Esc/M keys):
///   On Foot (F1), Vehicle (F2), Aircraft (F3), Menu (F4), Map (F5)
/// Mouse settings are calibrated for GTA 6's in-game controller settings:
/// Sens 14, Accel 14, Aggressive curve (4/4), LS Deadzone 7, RS Deadzone 3.
pub fn gta6_profile() -> Profile {
    use Target::*;
    Profile {
        id: "gta6".into(),
        name: "GTA VI".into(),
        game: "Grand Theft Auto VI".into(),
        auto_switch_app: String::new(),
        builtin: true,
        aim: AimSettings {
            target: AimTarget::RightStick,
            sensitivity: 10.5,
            ads_multiplier: 0.65,
            curve_mode: CurveMode::Exponent,
            exponent: 0.58,
            anti_deadzone: 0.06,
            deadzone_shape: DeadzoneShape::Radial,
            boost: 0.02,
            smoothing_ms: 3.5,
            overflow_ms: 0.0,
            dithering: true,
            max_output: 1.0,
            ..Default::default()
        },
        movement: MovementSettings::default(),
        hud: HudConfig {
            enabled: false,
            threshold: 0.78,
            base_rule: HudRule { zone: HudZone::TopBar, samples: Vec::new() },
        },
        // Base layer: PS5 Menu & system navigation
        bindings: vec![
            bl("Up", DpadUp, "Navigate Up"),
            bl("Down", DpadDown, "Navigate Down"),
            bl("Left", DpadLeft, "Navigate Left"),
            bl("Right", DpadRight, "Navigate Right"),
            bl("W", DpadUp, "Navigate Up"),
            bl("S", DpadDown, "Navigate Down"),
            bl("A", DpadLeft, "Navigate Left"),
            bl("D", DpadRight, "Navigate Right"),
            bl("Enter", Cross, "Select / Confirm"),
            bl("Space", Cross, "Select / Confirm"),
            bl("Mouse1", Cross, "Select / Confirm"),
            bl("Esc", Circle, "Back / Cancel"),
            bl("Backspace", Circle, "Back / Cancel"),
            bl("Mouse2", Circle, "Back / Cancel"),
            bl("Q", L1, "Tab Left"),
            bl("E", R1, "Tab Right"),
            bl("Tab", Options, "Options"),
            bl("H", PS, "PS Home Button"),
            bl("P", Share, "Create / Share"),
            bl("M", Touchpad, "Touchpad"),
            bl("WheelUp", DpadUp, "Scroll Up"),
            bl("WheelDown", DpadDown, "Scroll Down"),
        ],
        layers: vec![
            Layer {
                name: "On Foot".into(),
                activator: "F1".into(),
                mode: BindMode::Toggle,
                aim_multiplier: Some(1.0),
                aim_target: Some(AimTarget::RightStick),
                hud: HudRule { zone: HudZone::TopRight, samples: Vec::new() },
                bindings: vec![
                    bl("W", LsUp, "Move Forward"),
                    bl("S", LsDown, "Move Backward"),
                    bl("A", LsLeft, "Move Left"),
                    bl("D", LsRight, "Move Right"),
                    bl("LAlt", Walk, "Walk Slowly"),
                    bl("LShift", L3, "Sprint"),
                    bl("Space", Cross, "Jump / Climb"),
                    bl("LCtrl", Circle, "Crouch / Rest"),
                    bl("Mouse1", R2, "Shoot / Attack"),
                    bl("Mouse2", L2, "Aim / Focus"),
                    bl("R", Square, "Melee / Reload"),
                    bl("F", Triangle, "Interact / Enter Vehicle"),
                    bl("E", Triangle, "Interact"),
                    bl("Q", R1, "Take Cover"),
                    bl("Tab", L1, "Weapon Wheel / Holster"),
                    bl("C", R3, "Look Behind"),
                    bl("Mouse3", R3, "Look Behind"),
                    bs("Esc", Options, "Pause Menu", "Menu"),
                    bs("M", Touchpad, "Open Map", "Map"),
                    bl("V", Touchpad, "Camera View"),
                    bl("Up", DpadUp, "Phone / Zoom In"),
                    bl("Down", DpadDown, "Quick Nav / Zoom Out"),
                    bl("Left", DpadLeft, "D-Pad Left"),
                    bl("Right", DpadRight, "Character Switch"),
                    bl("T", DpadUp, "Open Phone"),
                    bl("WheelUp", DpadUp, "Scroll Up"),
                    bl("WheelDown", DpadDown, "Scroll Down"),
                    bl("Enter", Cross, "Confirm"),
                    bl("Backspace", Circle, "Back"),
                    bl("P", Share, "Share / Clip"),
                    bl("H", PS, "PS Home Button"),
                ],
            },
            Layer {
                name: "Vehicle".into(),
                activator: "F2".into(),
                mode: BindMode::Toggle,
                aim_multiplier: Some(0.72),
                aim_target: Some(AimTarget::RightStick),
                hud: HudRule { zone: HudZone::BottomRight, samples: Vec::new() },
                bindings: vec![
                    bl("W", R2, "Gas / Accelerate"),
                    bl("S", L2, "Brake / Reverse"),
                    bl("A", LsLeft, "Steer Left"),
                    bl("D", LsRight, "Steer Right"),
                    bl("LAlt", Feather, "Cruise Throttle (55%)"),
                    bl("Space", Cross, "Handbrake"),
                    bl("F", Triangle, "Exit Vehicle"),
                    bl("LShift", L3, "Horn / Nitrous"),
                    bl("E", L3, "Horn"),
                    bl("H", Circle, "Headlights"),
                    bl("Mouse1", R1, "Drive-By Shoot"),
                    bl("Mouse2", L2, "Drive-By Aim"),
                    bl("C", R3, "Look Behind"),
                    bl("Mouse3", R3, "Look Behind"),
                    bl("Q", DpadLeft, "Radio"),
                    bl("WheelUp", DpadLeft, "Radio"),
                    bl("WheelDown", DpadLeft, "Radio"),
                    bl("R", DpadDown, "Cinematic Camera"),
                    bl("V", Touchpad, "Camera View"),
                    bs("Esc", Options, "Pause Menu", "Menu"),
                    bs("M", Touchpad, "Open Map", "Map"),
                    bl("Up", DpadUp, "D-Pad Up"),
                    bl("Down", DpadDown, "D-Pad Down"),
                    bl("Left", DpadLeft, "D-Pad Left"),
                    bl("Right", DpadRight, "D-Pad Right"),
                ],
            },
            Layer {
                name: "Aircraft".into(),
                activator: "F3".into(),
                mode: BindMode::Toggle,
                aim_multiplier: Some(0.8),
                aim_target: Some(AimTarget::RightStick),
                hud: HudRule { zone: HudZone::BottomRight, samples: Vec::new() },
                bindings: vec![
                    bl("W", R2, "Throttle Up"),
                    bl("S", L2, "Throttle Down"),
                    bl("Mouse2", R2, "Throttle Up"),
                    bl("A", L1, "Yaw Left"),
                    bl("D", R1, "Yaw Right"),
                    bl("Num8", LsUp, "Pitch Down"),
                    bl("Num5", LsDown, "Pitch Up"),
                    bl("Num4", LsLeft, "Roll Left"),
                    bl("Num6", LsRight, "Roll Right"),
                    bl("Space", Square, "Fire Weapons"),
                    bl("Mouse1", Square, "Fire Weapons"),
                    bl("Tab", Triangle, "Cycle Weapons"),
                    bl("G", L3, "Landing Gear"),
                    bl("F", Triangle, "Exit Aircraft"),
                    bl("C", R3, "Look Behind"),
                    bl("V", Touchpad, "Camera View"),
                    bs("Esc", Options, "Pause Menu", "Menu"),
                    bs("M", Touchpad, "Open Map", "Map"),
                    bl("Up", DpadUp, "D-Pad Up"),
                    bl("Down", DpadDown, "D-Pad Down"),
                    bl("Left", DpadLeft, "D-Pad Left"),
                    bl("Right", DpadRight, "D-Pad Right"),
                ],
            },
            Layer {
                name: "Menu".into(),
                activator: "F4".into(),
                mode: BindMode::Toggle,
                aim_multiplier: None,
                aim_target: Some(AimTarget::Off),
                hud: HudRule { zone: HudZone::TopLeft, samples: Vec::new() },
                bindings: vec![
                    bl("Up", DpadUp, "Menu Up"),
                    bl("Down", DpadDown, "Menu Down"),
                    bl("Left", DpadLeft, "Menu Left"),
                    bl("Right", DpadRight, "Menu Right"),
                    bl("W", DpadUp, "Menu Up"),
                    bl("S", DpadDown, "Menu Down"),
                    bl("A", DpadLeft, "Menu Left"),
                    bl("D", DpadRight, "Menu Right"),
                    bl("Enter", Cross, "Confirm"),
                    bl("Space", Cross, "Confirm"),
                    bl("Mouse1", Cross, "Confirm"),
                    bs("Esc", Circle, "Close Menu", "__prev__"),
                    bl("Backspace", Circle, "Back"),
                    bl("Mouse2", Circle, "Back"),
                    bl("Q", L1, "Tab Left"),
                    bl("E", R1, "Tab Right"),
                    bl("Tab", R1, "Tab Right"),
                    bl("WheelUp", DpadUp, "Scroll Up"),
                    bl("WheelDown", DpadDown, "Scroll Down"),
                    bl("P", Options, "Pause Toggle"),
                ],
            },
            Layer {
                name: "Map".into(),
                activator: "F5".into(),
                mode: BindMode::Toggle,
                aim_multiplier: Some(0.55),
                aim_target: Some(AimTarget::LeftStick),
                hud: HudRule { zone: HudZone::BottomLeft, samples: Vec::new() },
                bindings: vec![
                    bl("W", LsUp, "Pan Up"),
                    bl("S", LsDown, "Pan Down"),
                    bl("A", LsLeft, "Pan Left"),
                    bl("D", LsRight, "Pan Right"),
                    bl("Up", LsUp, "Pan Up"),
                    bl("Down", LsDown, "Pan Down"),
                    bl("Left", LsLeft, "Pan Left"),
                    bl("Right", LsRight, "Pan Right"),
                    bl("WheelUp", DpadUp, "Zoom In"),
                    bl("WheelDown", DpadDown, "Zoom Out"),
                    bl("OemPlus", DpadUp, "Zoom In"),
                    bl("OemMinus", DpadDown, "Zoom Out"),
                    bl("E", R2, "Zoom In"),
                    bl("Q", L2, "Zoom Out"),
                    bl("Enter", Cross, "Place Waypoint"),
                    bl("Mouse1", Cross, "Place Waypoint"),
                    bl("Space", Square, "Legend / Filter"),
                    bl("Tab", L1, "Switch Map Layer"),
                    bs("Esc", Circle, "Close Map", "__prev__"),
                    bl("Backspace", Circle, "Back"),
                    bl("Mouse2", Circle, "Back"),
                    bs("M", Touchpad, "Close Map", "__prev__"),
                ],
            },
        ],
    }
}

pub fn blank_profile(id: &str, name: &str) -> Profile {
    use Target::*;
    Profile {
        id: id.into(),
        name: name.into(),
        game: String::new(),
        auto_switch_app: String::new(),
        builtin: false,
        aim: AimSettings::default(),
        movement: MovementSettings::default(),
        hud: HudConfig::default(),
        bindings: vec![
            b("W", LsUp),
            b("S", LsDown),
            b("A", LsLeft),
            b("D", LsRight),
            b("Mouse1", R2),
            b("Mouse2", L2),
            b("Space", Cross),
            b("Esc", Options),
        ],
        layers: vec![],
    }
}
