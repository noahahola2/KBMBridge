//! Virtual controller output through the ViGEmBus driver.

use crate::profile::ControllerType;
use vigem_client::{Client, DS4Report, DualShock4Wired, TargetId, XButtons, XGamepad, Xbox360Wired};

/// Final controller state. Sticks are -1..1 with +y = up, triggers 0..1.
#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Serialize)]
pub struct PadState {
    pub buttons: u32,
    pub lx: f32,
    pub ly: f32,
    pub rx: f32,
    pub ry: f32,
    pub l2: f32,
    pub r2: f32,
}

/// Quantized report actually sent to the driver.
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub struct Quantized {
    pub buttons: u32,
    pub sticks: [i32; 4],
    pub l2: u8,
    pub r2: u8,
}

enum Target {
    X360(Xbox360Wired<Client>),
    Ds4(DualShock4Wired<Client>),
}

pub struct Output {
    target: Option<Target>,
    pub kind: ControllerType,
    pub error: Option<String>,
}

impl Output {
    pub fn new() -> Self {
        Self { target: None, kind: ControllerType::DualShock4, error: None }
    }

    pub fn connected(&self) -> bool {
        self.target.is_some()
    }

    /// Stick resolution (steps from center to edge) for the active controller type.
    pub fn stick_levels(&self) -> f32 {
        match self.kind {
            ControllerType::DualShock4 => 127.0,
            ControllerType::Xbox360 => 32767.0,
        }
    }

    pub fn connect(&mut self, kind: ControllerType) {
        self.disconnect();
        self.kind = kind;
        let client = match Client::connect() {
            Ok(c) => c,
            Err(e) => {
                self.error = Some(match e {
                    vigem_client::Error::BusNotFound => "ViGEmBus driver not installed".into(),
                    vigem_client::Error::BusVersionMismatch => "ViGEmBus version mismatch".into(),
                    other => format!("ViGEmBus error: {other:?}"),
                });
                return;
            }
        };
        let res = match kind {
            ControllerType::Xbox360 => {
                let mut t = Xbox360Wired::new(client, TargetId::XBOX360_WIRED);
                t.plugin().and_then(|_| t.wait_ready()).map(|_| Target::X360(t))
            }
            ControllerType::DualShock4 => {
                let mut t = DualShock4Wired::new(client, TargetId::DUALSHOCK4_WIRED);
                t.plugin().and_then(|_| t.wait_ready()).map(|_| Target::Ds4(t))
            }
        };
        match res {
            Ok(t) => {
                self.target = Some(t);
                self.error = None;
            }
            Err(e) => self.error = Some(format!("Could not create virtual controller: {e:?}")),
        }
    }

    pub fn disconnect(&mut self) {
        self.target = None; // Drop unplugs.
    }

    pub fn submit(&mut self, q: &Quantized) -> bool {
        let ok = match &mut self.target {
            None => return false,
            Some(Target::X360(t)) => t.update(&to_x360(q)).is_ok(),
            Some(Target::Ds4(t)) => t.update(&to_ds4(q)).is_ok(),
        };
        if !ok {
            self.error = Some("Virtual controller update failed".into());
        }
        ok
    }
}

const fn bit(b: u32, i: u32) -> bool {
    b & (1 << i) != 0
}

fn to_x360(q: &Quantized) -> XGamepad {
    let b = q.buttons;
    let mut raw = 0u16;
    let map: [(u32, u16); 16] = [
        (0, XButtons::A),
        (1, XButtons::B),
        (2, XButtons::X),
        (3, XButtons::Y),
        (4, XButtons::LB),
        (5, XButtons::RB),
        (6, XButtons::LTHUMB),
        (7, XButtons::RTHUMB),
        (8, XButtons::BACK),
        (9, XButtons::START),
        (10, XButtons::GUIDE),
        (11, XButtons::BACK),
        (12, XButtons::UP),
        (13, XButtons::DOWN),
        (14, XButtons::LEFT),
        (15, XButtons::RIGHT),
    ];
    for (i, m) in map {
        if bit(b, i) {
            raw |= m;
        }
    }
    XGamepad {
        buttons: XButtons(raw),
        left_trigger: q.l2,
        right_trigger: q.r2,
        thumb_lx: q.sticks[0].clamp(-32768, 32767) as i16,
        thumb_ly: q.sticks[1].clamp(-32768, 32767) as i16,
        thumb_rx: q.sticks[2].clamp(-32768, 32767) as i16,
        thumb_ry: q.sticks[3].clamp(-32768, 32767) as i16,
    }
}

fn to_ds4(q: &Quantized) -> DS4Report {
    let b = q.buttons;
    let (up, down, left, right) = (bit(b, 12), bit(b, 13), bit(b, 14), bit(b, 15));
    let hat: u16 = match (up && !down, down && !up, left && !right, right && !left) {
        (true, _, false, false) => 0,
        (true, _, _, true) => 1,
        (false, false, false, true) => 2,
        (_, true, _, true) => 3,
        (_, true, false, false) => 4,
        (_, true, true, _) => 5,
        (false, false, true, false) => 6,
        (true, _, true, _) => 7,
        _ => 8,
    };
    let mut buttons = hat;
    let map: [(u32, u16); 10] = [
        (2, 1 << 4),  // Square
        (0, 1 << 5),  // Cross
        (1, 1 << 6),  // Circle
        (3, 1 << 7),  // Triangle
        (4, 1 << 8),  // L1
        (5, 1 << 9),  // R1
        (8, 1 << 12), // Share
        (9, 1 << 13), // Options
        (6, 1 << 14), // L3
        (7, 1 << 15), // R3
    ];
    for (i, m) in map {
        if bit(b, i) {
            buttons |= m;
        }
    }
    if q.l2 > 0 {
        buttons |= 1 << 10;
    }
    if q.r2 > 0 {
        buttons |= 1 << 11;
    }
    let mut special = 0u8;
    if bit(b, 10) {
        special |= 1;
    }
    if bit(b, 11) {
        special |= 2;
    }
    // DS4 axes: 0..255, 128 = center, Y grows downward.
    let ax = |v: i32| (128 + v).clamp(0, 255) as u8;
    let ay = |v: i32| (128 - v).clamp(0, 255) as u8;
    DS4Report {
        thumb_lx: ax(q.sticks[0]),
        thumb_ly: ay(q.sticks[1]),
        thumb_rx: ax(q.sticks[2]),
        thumb_ry: ay(q.sticks[3]),
        buttons,
        special,
        trigger_l: q.l2,
        trigger_r: q.r2,
    }
}
