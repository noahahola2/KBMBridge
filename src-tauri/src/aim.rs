//! Mouse -> analog stick translation (low-latency weighted velocity + response linearization).
//!
//! Pipeline (per output tick, default 1000 Hz):
//!  1. Raw, unaccelerated HID deltas with high-resolution timestamps (from Raw Input).
//!  2. Adaptive triangular-weighted velocity estimator.
//!     - Newer mouse packets carry linearly higher weight than older ones, cutting group delay
//!       nearly in half compared to a flat boxcar window and giving instant flick stops with zero
//!       ringing while eliminating polling-rate aliasing across 125 Hz – 8000 Hz mice.
//!     - Window floor adapts automatically to the measured mouse polling interval.
//!  3. Sensitivity / ADS / active-layer multipliers and Y/X ratio in the linear turn-speed domain.
//!  4. Optional overflow memory (Smart Carry): excess speed above max in-game turn rate is banked
//!     and paid out immediately afterward so physical mouse distance matches total rotation.
//!  5. Response curve (inverse power exponent or custom Fritsch-Carlson monotone cubic spline LUT)
//!     to cancel out console game stick acceleration curves (e.g. Rockstar / GTA).
//!  6. Boost + Anti-Deadzone (Radial or Axial) to jump cleanly over the game's inner deadzone and
//!     initial aim-acceleration ramp, clamped to the outer deadzone (`max_output`).
//!  7. (in engine) First-order error-diffusion temporal dithering on quantized stick output so even
//!     8-bit DualShock 4 axes achieve sub-step micro-aim precision.

use crate::profile::{AimSettings, CurveMode, DeadzoneShape};
use std::collections::VecDeque;

const LUT_SIZE: usize = 1024;

pub struct AimProcessor {
    events: VecDeque<(f64, f32, f32)>,
    poll_interval: f64,
    last_event_t: f64,
    carry: [f32; 2],
    lut: Vec<f32>,
    lut_key: (u8, u32, Vec<[u32; 2]>),
}

impl Default for AimProcessor {
    fn default() -> Self {
        Self {
            events: VecDeque::with_capacity(512),
            poll_interval: 0.001,
            last_event_t: 0.0,
            carry: [0.0; 2],
            lut: Vec::new(),
            lut_key: (255, 0, Vec::new()),
        }
    }
}

impl AimProcessor {
    pub fn push(&mut self, t: f64, dx: f32, dy: f32) {
        let gap = t - self.last_event_t;
        if gap > 0.00005 && gap < 0.02 {
            // Fast-adapting EMA of inter-report interval while moving.
            self.poll_interval += (gap - self.poll_interval) * 0.08;
        }
        self.last_event_t = t;
        self.events.push_back((t, dx, dy));
    }

    pub fn polling_hz(&self) -> f32 {
        (1.0 / self.poll_interval.max(1e-5)) as f32
    }

    pub fn reset(&mut self) {
        self.events.clear();
        self.carry = [0.0; 2];
    }

    fn ensure_lut(&mut self, s: &AimSettings) {
        let key = (
            s.curve_mode as u8,
            s.exponent.to_bits(),
            s.curve_points
                .iter()
                .map(|p| [p[0].to_bits(), p[1].to_bits()])
                .collect::<Vec<_>>(),
        );
        if key == self.lut_key && !self.lut.is_empty() {
            return;
        }
        self.lut = build_lut(s);
        self.lut_key = key;
    }

    /// Returns stick deflection (x, y) in -1..1 with +y = up.
    pub fn process(&mut self, now: f64, dt: f64, s: &AimSettings, mult: f32) -> [f32; 2] {
        self.ensure_lut(s);

        // Adaptive window: respects user smoothing_ms while never dropping below ~1.6x mouse poll
        // interval so 125/500/1000/4000/8000 Hz mice never alias against the output tick.
        let min_win = (self.poll_interval * 1.6).max(dt * 1.25);
        let window = (s.smoothing_ms as f64 / 1000.0).max(min_win).min(0.05);
        let cutoff = now - window;
        while let Some(&(t, _, _)) = self.events.front() {
            if t <= cutoff {
                self.events.pop_front();
            } else {
                break;
            }
        }

        // Triangular-weighted velocity estimate:
        // weight(age) = 1 - age / window, integral over [0, window] = window / 2.
        // Thus v = (2 / window) * sum(d_i * (1 - age_i / window)).
        // For constant velocity this is exact, and on a sudden stop it decays immediately
        // instead of holding a flat tail like a boxcar filter.
        let (mut wx, mut wy) = (0.0f32, 0.0f32);
        let inv_w = (1.0 / window) as f32;
        for &(t, dx, dy) in &self.events {
            let age = (now - t).clamp(0.0, window) as f32;
            let weight = 1.0 - age * inv_w;
            wx += dx * weight;
            wy += dy * weight;
        }
        let vel_norm = 2.0 * inv_w;
        let scale = if s.use_cm360 {
            let counts_360 = (s.cm_per_360.clamp(3.0, 120.0) / 2.54) * (s.mouse_dpi.clamp(100, 30000) as f32);
            let full_stick_cps = (s.max_turn_dps.clamp(30.0, 1200.0) / 360.0) * counts_360;
            mult / full_stick_cps.max(100.0)
        } else {
            s.sensitivity.max(0.01) * mult / 20000.0
        };
        let mut ux = wx * vel_norm * scale;
        let mut uy = -wy * vel_norm * scale * s.y_ratio;
        if s.invert_y {
            uy = -uy;
        }

        // Overflow memory (linear turn-speed domain, 1.0 == game's max turn speed).
        let dtf = dt as f32;
        if s.overflow_ms > 0.0 {
            let cap = s.overflow_ms / 1000.0;
            let m = (ux * ux + uy * uy).sqrt();
            // Clear banked carry immediately if the user reverses direction.
            if ux * self.carry[0] + uy * self.carry[1] < 0.0 {
                self.carry = [0.0; 2];
            }
            if m > 1.0 {
                let ex = (m - 1.0) * dtf / m;
                self.carry[0] += ux * ex;
                self.carry[1] += uy * ex;
                let cm = (self.carry[0].powi(2) + self.carry[1].powi(2)).sqrt();
                if cm > cap {
                    self.carry[0] *= cap / cm;
                    self.carry[1] *= cap / cm;
                }
                ux /= m;
                uy /= m;
            } else {
                let cm = (self.carry[0].powi(2) + self.carry[1].powi(2)).sqrt();
                if cm > 1e-6 && dtf > 0.0 {
                    let pay = cm.min((1.0 - m) * dtf);
                    let f = pay / cm;
                    ux += self.carry[0] * f / dtf;
                    uy += self.carry[1] * f / dtf;
                    self.carry[0] -= self.carry[0] * f;
                    self.carry[1] -= self.carry[1] * f;
                }
            }
        } else {
            self.carry = [0.0; 2];
        }

        let m = (ux * ux + uy * uy).sqrt();
        if m < 1e-4 {
            return [0.0, 0.0];
        }
        let (dx, dy) = (ux / m, uy / m);
        let max_out = s.max_output.clamp(0.05, 1.0);
        let boost = s.boost.clamp(0.0, 0.45);
        // Curve maps 0..1 linear turn speed -> 0..1 stick range above deadzone,
        // with optional initial boost to punch through console aim-acceleration ramp.
        let shaped = (boost + (1.0 - boost) * self.curve(m.min(1.0))).clamp(0.0, 1.0);
        let adz = s.anti_deadzone.clamp(0.0, 0.65);
        let usable = (max_out - adz).max(0.05);

        let (mut ox, mut oy) = match s.deadzone_shape {
            DeadzoneShape::Radial => {
                let r = adz + usable * shaped;
                (dx * r, dy * r)
            }
            DeadzoneShape::Axial => {
                let ax = |comp: f32| -> f32 {
                    let a = shaped * comp.abs();
                    if a < 1e-3 {
                        0.0
                    } else {
                        comp.signum() * (adz + usable * a)
                    }
                };
                (ax(dx), ax(dy))
            }
        };
        let r = (ox * ox + oy * oy).sqrt();
        if r > max_out {
            ox *= max_out / r;
            oy *= max_out / r;
        }
        [ox, oy]
    }

    fn curve(&self, x: f32) -> f32 {
        let f = x.clamp(0.0, 1.0) * (LUT_SIZE - 1) as f32;
        let i = f as usize;
        if i >= LUT_SIZE - 1 {
            return self.lut[LUT_SIZE - 1];
        }
        let t = f - i as f32;
        self.lut[i] * (1.0 - t) + self.lut[i + 1] * t
    }
}

fn build_lut(s: &AimSettings) -> Vec<f32> {
    let mut lut = vec![0.0f32; LUT_SIZE];
    match s.curve_mode {
        CurveMode::Exponent => {
            let e = s.exponent.clamp(0.2, 4.0);
            for (i, v) in lut.iter_mut().enumerate() {
                *v = (i as f32 / (LUT_SIZE - 1) as f32).powf(e);
            }
        }
        CurveMode::Custom => {
            let spline = MonotoneSpline::new(&s.curve_points);
            for (i, v) in lut.iter_mut().enumerate() {
                *v = spline.eval(i as f32 / (LUT_SIZE - 1) as f32).clamp(0.0, 1.0);
            }
        }
    }
    lut
}

/// Fritsch–Carlson monotone cubic interpolation.
struct MonotoneSpline {
    xs: Vec<f32>,
    ys: Vec<f32>,
    ms: Vec<f32>,
}

impl MonotoneSpline {
    fn new(points: &[[f32; 2]]) -> Self {
        let mut pts: Vec<[f32; 2]> = points
            .iter()
            .map(|p| [p[0].clamp(0.0, 1.0), p[1].clamp(0.0, 1.0)])
            .collect();
        pts.sort_by(|a, b| a[0].partial_cmp(&b[0]).unwrap_or(std::cmp::Ordering::Equal));
        pts.dedup_by(|a, b| (a[0] - b[0]).abs() < 1e-4);
        if pts.first().map_or(true, |p| p[0] > 0.0) {
            pts.insert(0, [0.0, 0.0]);
        }
        if pts.last().map_or(true, |p| p[0] < 1.0) {
            pts.push([1.0, 1.0]);
        }
        for i in 1..pts.len() {
            if pts[i][1] < pts[i - 1][1] {
                pts[i][1] = pts[i - 1][1];
            }
        }
        let n = pts.len();
        let xs: Vec<f32> = pts.iter().map(|p| p[0]).collect();
        let ys: Vec<f32> = pts.iter().map(|p| p[1]).collect();
        let d: Vec<f32> = (0..n - 1).map(|i| (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i])).collect();
        let mut ms = vec![0.0f32; n];
        ms[0] = d[0];
        ms[n - 1] = d[n - 2];
        for i in 1..n - 1 {
            ms[i] = if d[i - 1] * d[i] <= 0.0 {
                0.0
            } else {
                (d[i - 1] + d[i]) / 2.0
            };
        }
        for i in 0..n - 1 {
            if d[i].abs() < 1e-9 {
                ms[i] = 0.0;
                ms[i + 1] = 0.0;
            } else {
                let a = ms[i] / d[i];
                let b = ms[i + 1] / d[i];
                let h = a * a + b * b;
                if h > 9.0 {
                    let t = 3.0 / h.sqrt();
                    ms[i] = t * a * d[i];
                    ms[i + 1] = t * b * d[i];
                }
            }
        }
        Self { xs, ys, ms }
    }

    fn eval(&self, x: f32) -> f32 {
        let n = self.xs.len();
        let mut i = 0;
        while i < n - 2 && x > self.xs[i + 1] {
            i += 1;
        }
        let h = self.xs[i + 1] - self.xs[i];
        let t = ((x - self.xs[i]) / h).clamp(0.0, 1.0);
        let t2 = t * t;
        let t3 = t2 * t;
        (2.0 * t3 - 3.0 * t2 + 1.0) * self.ys[i]
            + (t3 - 2.0 * t2 + t) * h * self.ms[i]
            + (-2.0 * t3 + 3.0 * t2) * self.ys[i + 1]
            + (t3 - t2) * h * self.ms[i + 1]
    }
}
