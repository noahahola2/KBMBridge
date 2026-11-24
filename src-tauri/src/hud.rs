//! Low-priority background HUD auto-detector.
//!
//! Captures tiny downsampled (16x10) RGB patches from HUD corners of the focused
//! game / stream window on a `THREAD_PRIORITY_BELOW_NORMAL` thread (~4.5 Hz) so
//! it adds 0 ms latency to input or controller output.

use crate::engine::EngineCtl;
use crate::input::{InputEvent, Shared};
use crate::profile::{BindMode, HudRule, HudZone};
use serde::Serialize;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::Graphics::Gdi::*;
use windows_sys::Win32::System::Threading::*;
use windows_sys::Win32::UI::WindowsAndMessaging::*;

pub const PATCH_W: i32 = 16;
pub const PATCH_H: i32 = 10;
pub const PATCH_LEN: usize = (PATCH_W * PATCH_H * 3) as usize;

#[derive(Clone, Default, Serialize)]
pub struct HudStatus {
    pub active_match: Option<String>,
    pub scores: Vec<(String, f32)>,
}

/// Captures a normalized HUD zone of `hwnd` and downsamples it to a 16x10 RGB vector (480 bytes).
pub fn capture_zone(hwnd: HWND, zone: HudZone) -> Option<Vec<u8>> {
    if hwnd.is_null() {
        return None;
    }
    unsafe {
        let mut cr = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        let mut sx = 0i32;
        let mut sy = 0i32;
        let mut sw = 0i32;
        let mut sh = 0i32;

        if GetClientRect(hwnd, &mut cr) != 0 && cr.right > 32 && cr.bottom > 32 {
            let mut pt = POINT { x: 0, y: 0 };
            if ClientToScreen(hwnd, &mut pt) != 0 {
                sx = pt.x;
                sy = pt.y;
                sw = cr.right;
                sh = cr.bottom;
            }
        }
        if sw <= 32 || sh <= 32 {
            let mut wr = RECT { left: 0, top: 0, right: 0, bottom: 0 };
            if GetWindowRect(hwnd, &mut wr) == 0 {
                return None;
            }
            sx = wr.left;
            sy = wr.top;
            sw = wr.right - wr.left;
            sh = wr.bottom - wr.top;
        }
        if sw <= 32 || sh <= 32 {
            return None;
        }

        let [rx, ry, rw, rh] = zone.rect();
        let src_x = sx + (sw as f32 * rx).round() as i32;
        let src_y = sy + (sh as f32 * ry).round() as i32;
        let src_w = ((sw as f32 * rw).round() as i32).max(16);
        let src_h = ((sh as f32 * rh).round() as i32).max(10);

        let screen_dc = GetDC(std::ptr::null_mut());
        if screen_dc.is_null() {
            return None;
        }
        let mem_dc = CreateCompatibleDC(screen_dc);
        if mem_dc.is_null() {
            ReleaseDC(std::ptr::null_mut(), screen_dc);
            return None;
        }

        let mut bmi: BITMAPINFO = std::mem::zeroed();
        bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bmi.bmiHeader.biWidth = PATCH_W;
        bmi.bmiHeader.biHeight = -PATCH_H; // top-down
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = BI_RGB;

        let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
        let hbmp = CreateDIBSection(mem_dc, &bmi, DIB_RGB_COLORS, &mut bits, std::ptr::null_mut(), 0);
        if hbmp.is_null() || bits.is_null() {
            if !hbmp.is_null() {
                DeleteObject(hbmp);
            }
            DeleteDC(mem_dc);
            ReleaseDC(std::ptr::null_mut(), screen_dc);
            return None;
        }

        let old_bmp = SelectObject(mem_dc, hbmp);
        SetStretchBltMode(mem_dc, HALFTONE as i32);
        let ok = StretchBlt(
            mem_dc,
            0,
            0,
            PATCH_W,
            PATCH_H,
            screen_dc,
            src_x,
            src_y,
            src_w,
            src_h,
            SRCCOPY,
        );

        let mut out = None;
        if ok != 0 {
            let px_count = (PATCH_W * PATCH_H) as usize;
            let bgra = std::slice::from_raw_parts(bits as *const u8, px_count * 4);
            let mut rgb = Vec::with_capacity(PATCH_LEN);
            for c in bgra.chunks_exact(4) {
                rgb.push(c[2]);
                rgb.push(c[1]);
                rgb.push(c[0]);
            }
            out = Some(rgb);
        }

        SelectObject(mem_dc, old_bmp);
        DeleteObject(hbmp);
        DeleteDC(mem_dc);
        ReleaseDC(std::ptr::null_mut(), screen_dc);
        out
    }
}

/// Structural + color similarity (0..1) between two 16x10 RGB patches.
pub fn similarity(a: &[u8], b: &[u8]) -> f32 {
    if a.len() != PATCH_LEN || b.len() != PATCH_LEN {
        return 0.0;
    }

    let mut diff_sum = 0u32;
    for i in 0..PATCH_LEN {
        diff_sum += (a[i] as i32 - b[i] as i32).unsigned_abs();
    }
    let sim_col = 1.0 - (diff_sum as f32 / (PATCH_LEN as f32 * 255.0));

    let px = (PATCH_W * PATCH_H) as usize;
    let mut lum_a = [0i32; (PATCH_W * PATCH_H) as usize];
    let mut lum_b = [0i32; (PATCH_W * PATCH_H) as usize];
    for i in 0..px {
        let p = i * 3;
        lum_a[i] = (77 * a[p] as i32 + 150 * a[p + 1] as i32 + 29 * a[p + 2] as i32) >> 8;
        lum_b[i] = (77 * b[p] as i32 + 150 * b[p + 1] as i32 + 29 * b[p + 2] as i32) >> 8;
    }

    let w = PATCH_W as usize;
    let h = PATCH_H as usize;
    let mut dot = 0.0f64;
    let mut na = 0.0f64;
    let mut nb = 0.0f64;
    for y in 0..h {
        for x in 0..w {
            let idx = y * w + x;
            let (gxa, gxb) = if x + 1 < w {
                ((lum_a[idx + 1] - lum_a[idx]) as f64, (lum_b[idx + 1] - lum_b[idx]) as f64)
            } else {
                (0.0, 0.0)
            };
            let (gya, gyb) = if y + 1 < h {
                ((lum_a[idx + w] - lum_a[idx]) as f64, (lum_b[idx + w] - lum_b[idx]) as f64)
            } else {
                (0.0, 0.0)
            };
            dot += gxa * gxb + gya * gyb;
            na += gxa * gxa + gya * gya;
            nb += gxb * gxb + gyb * gyb;
        }
    }

    let sim_edge = if na < 1.0 && nb < 1.0 {
        1.0
    } else if na < 1.0 || nb < 1.0 {
        0.0
    } else {
        (dot / (na.sqrt() * nb.sqrt())).clamp(0.0, 1.0) as f32
    };

    (0.55 * sim_col + 0.45 * sim_edge).clamp(0.0, 1.0)
}

fn score_rule(rule: &HudRule, live: &[(HudZone, Vec<u8>)]) -> Option<f32> {
    if rule.samples.is_empty() {
        return None;
    }
    let patch = live.iter().find(|(z, _)| *z == rule.zone).map(|(_, p)| p)?;
    let mut best = 0.0f32;
    for s in &rule.samples {
        best = best.max(similarity(&s.rgb, patch));
    }
    Some(best)
}

pub fn start(ctl: Arc<EngineCtl>, shared: Arc<Shared>) {
    std::thread::Builder::new()
        .name("kbm-hud".into())
        .spawn(move || unsafe {
            SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_BELOW_NORMAL as i32);
            let own_pid = GetCurrentProcessId();
            let mut last_winner: Option<Option<usize>> = None;
            let mut streak = 0u8;

            loop {
                std::thread::sleep(Duration::from_millis(220));
                let cfg = ctl.config.load();
                let hud = &cfg.profile.hud;
                if !hud.enabled {
                    *ctl.hud_status.lock() = HudStatus::default();
                    last_winner = None;
                    streak = 0;
                    continue;
                }

                let fg = GetForegroundWindow();
                let mut pid = 0u32;
                GetWindowThreadProcessId(fg, &mut pid);
                let focus_ok = !cfg.settings.auto_focus || ctl.focus_ok.load(Ordering::Relaxed);
                if fg.is_null() || pid == own_pid || pid == 0 || !focus_ok {
                    last_winner = None;
                    streak = 0;
                    continue;
                }

                // Gather unique zones needed.
                let mut zones: Vec<HudZone> = Vec::new();
                if !hud.base_rule.samples.is_empty() {
                    zones.push(hud.base_rule.zone);
                }
                for l in &cfg.profile.layers {
                    if !l.hud.samples.is_empty() && !zones.contains(&l.hud.zone) {
                        zones.push(l.hud.zone);
                    }
                }
                if zones.is_empty() {
                    *ctl.hud_status.lock() = HudStatus::default();
                    continue;
                }

                let mut live: Vec<(HudZone, Vec<u8>)> = Vec::with_capacity(zones.len());
                for z in zones {
                    if let Some(p) = capture_zone(fg, z) {
                        live.push((z, p));
                    }
                }

                let mut scores: Vec<(String, f32)> = Vec::new();
                let mut best_target: Option<Option<usize>> = None;
                let mut best_score = 0.0f32;
                let mut best_name: Option<String> = None;

                if let Some(sc) = score_rule(&hud.base_rule, &live) {
                    scores.push(("Base".into(), sc));
                    if sc >= hud.threshold && sc > best_score {
                        best_score = sc;
                        best_target = Some(None);
                        best_name = Some("Base".into());
                    }
                }
                for (i, l) in cfg.profile.layers.iter().enumerate() {
                    if l.mode != BindMode::Toggle {
                        continue;
                    }
                    if let Some(sc) = score_rule(&l.hud, &live) {
                        scores.push((l.name.clone(), sc));
                        if sc >= hud.threshold && sc > best_score {
                            best_score = sc;
                            best_target = Some(Some(i));
                            best_name = Some(l.name.clone());
                        }
                    }
                }

                *ctl.hud_status.lock() = HudStatus {
                    active_match: best_name.clone(),
                    scores,
                };

                let Some(winner) = best_target else {
                    last_winner = None;
                    streak = 0;
                    continue;
                };

                if last_winner == Some(winner) {
                    streak = streak.saturating_add(1);
                } else {
                    last_winner = Some(winner);
                    streak = 1;
                }

                if streak < 2 {
                    continue;
                }

                // Respect manual key switches for 3 seconds before overriding.
                let manual_elapsed = Instant::now().duration_since(*ctl.last_manual_layer.lock());
                if manual_elapsed < Duration::from_secs(3) {
                    continue;
                }

                let current_layers = ctl.snapshot.lock().layers.clone();
                let target_name = winner.and_then(|i| cfg.profile.layers.get(i).map(|l| l.name.as_str()));
                let already_active = match target_name {
                    None => current_layers.is_empty(),
                    Some(name) => current_layers.iter().any(|x| x == name),
                };

                if !already_active {
                    *ctl.set_layer.lock() = Some(winner);
                    shared.push(InputEvent::ToggleArmed);
                }
            }
        })
        .expect("hud thread");
}
