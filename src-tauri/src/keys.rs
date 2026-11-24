//! Input source identifiers. Keyboard keys use their Windows virtual-key code (0..=255);
//! mouse buttons and wheel directions live above that range.

pub const M_LEFT: u16 = 256;
pub const M_RIGHT: u16 = 257;
pub const M_MIDDLE: u16 = 258;
pub const M_X1: u16 = 259;
pub const M_X2: u16 = 260;
pub const WHEEL_UP: u16 = 261;
pub const WHEEL_DOWN: u16 = 262;
pub const SOURCE_COUNT: usize = 264;

const NAMED: &[(u16, &str)] = &[
    (0x08, "Backspace"),
    (0x09, "Tab"),
    (0x0D, "Enter"),
    (0x13, "Pause"),
    (0x14, "CapsLock"),
    (0x1B, "Esc"),
    (0x20, "Space"),
    (0x21, "PageUp"),
    (0x22, "PageDown"),
    (0x23, "End"),
    (0x24, "Home"),
    (0x25, "Left"),
    (0x26, "Up"),
    (0x27, "Right"),
    (0x28, "Down"),
    (0x2D, "Insert"),
    (0x2E, "Delete"),
    (0x5B, "LWin"),
    (0x5C, "RWin"),
    (0x5D, "Menu"),
    (0x6A, "NumMul"),
    (0x6B, "NumAdd"),
    (0x6D, "NumSub"),
    (0x6E, "NumDecimal"),
    (0x6F, "NumDiv"),
    (0x90, "NumLock"),
    (0x91, "ScrollLock"),
    (0xA0, "LShift"),
    (0xA1, "RShift"),
    (0xA2, "LCtrl"),
    (0xA3, "RCtrl"),
    (0xA4, "LAlt"),
    (0xA5, "RAlt"),
    (0xBA, "Oem1"),
    (0xBB, "OemPlus"),
    (0xBC, "OemComma"),
    (0xBD, "OemMinus"),
    (0xBE, "OemPeriod"),
    (0xBF, "Oem2"),
    (0xC0, "Oem3"),
    (0xDB, "Oem4"),
    (0xDC, "Oem5"),
    (0xDD, "Oem6"),
    (0xDE, "Oem7"),
    (0xE2, "Oem102"),
    (M_LEFT, "Mouse1"),
    (M_RIGHT, "Mouse2"),
    (M_MIDDLE, "Mouse3"),
    (M_X1, "Mouse4"),
    (M_X2, "Mouse5"),
    (WHEEL_UP, "WheelUp"),
    (WHEEL_DOWN, "WheelDown"),
];

pub fn code_to_name(code: u16) -> String {
    match code {
        0x30..=0x39 | 0x41..=0x5A => ((code as u8) as char).to_string(),
        0x60..=0x69 => format!("Num{}", code - 0x60),
        0x70..=0x87 => format!("F{}", code - 0x6F),
        _ => NAMED
            .iter()
            .find(|(c, _)| *c == code)
            .map(|(_, n)| n.to_string())
            .unwrap_or_else(|| format!("VK{:02X}", code)),
    }
}

pub fn name_to_code(name: &str) -> Option<u16> {
    if name.len() == 1 {
        let c = name.chars().next()?.to_ascii_uppercase();
        if c.is_ascii_alphanumeric() {
            return Some(c as u16);
        }
    }
    if let Some((c, _)) = NAMED.iter().find(|(_, n)| n.eq_ignore_ascii_case(name)) {
        return Some(*c);
    }
    if let Some(rest) = name.strip_prefix("Num") {
        if let Ok(n) = rest.parse::<u16>() {
            if n <= 9 {
                return Some(0x60 + n);
            }
        }
    }
    if let Some(rest) = name.strip_prefix('F') {
        if let Ok(n) = rest.parse::<u16>() {
            if (1..=24).contains(&n) {
                return Some(0x6F + n);
            }
        }
    }
    if let Some(rest) = name.strip_prefix("VK") {
        return u16::from_str_radix(rest, 16).ok().filter(|c| *c < 256);
    }
    None
}

/// Every key name the UI might need a localized label for (OEM keys depend on layout).
pub fn layout_labels() -> Vec<(String, String)> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{MapVirtualKeyW, MAPVK_VK_TO_CHAR};
    let mut out = Vec::new();
    for &(code, name) in NAMED {
        if name.starts_with("Oem") {
            let ch = unsafe { MapVirtualKeyW(code as u32, MAPVK_VK_TO_CHAR) } & 0x7FFF_FFFF;
            if let Some(c) = char::from_u32(ch).filter(|c| !c.is_control() && *c != '\0') {
                out.push((name.to_string(), c.to_uppercase().to_string()));
            }
        }
    }
    out
}
