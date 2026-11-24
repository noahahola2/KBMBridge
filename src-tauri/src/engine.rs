//! The mapping engine: a time-critical thread that turns input events into controller reports.
//!
//! * Key / button events wake the thread immediately through a kernel event and are sent to the
//!   virtual controller within microseconds (no waiting for the next tick).
//! * Mouse aim is evaluated on a high-resolution waitable timer (default 1000 Hz).
//! * Reports are only submitted when the quantized state actually changes.

use crate::aim::AimProcessor;
use crate::input::{InputEvent, Shared};
use crate::keys::*;
use crate::output::{Output, PadState, Quantized};
use crate::profile::*;
use arc_swap::ArcSwap;
use parking_lot::Mutex;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::System::Threading::*;

pub struct EngineConfig {
    pub settings: Settings,
    pub profile: Profile,
}

#[derive(Clone, Default, Serialize)]
pub struct Snapshot {
    pub pad: PadState,
    pub active: bool,
    pub armed: bool,
    pub temp_released: bool,
    pub focus_ok: bool,
    pub connected: bool,
    pub driver_error: Option<String>,
    pub controller: ControllerType,
    pub key_latency_us: f32,
    pub mouse_latency_us: f32,
    pub mouse_hz: f32,
    pub submit_hz: f32,
    pub tick_hz: f32,
    pub layers: Vec<String>,
    pub foreground: String,
    pub profile: String,
    pub hud_match: Option<String>,
    pub hud_scores: Vec<(String, f32)>,
}

pub struct EngineCtl {
    pub config: ArcSwap<EngineConfig>,
    pub version: AtomicU64,
    pub snapshot: Mutex<Snapshot>,
    pub test_stick: Mutex<Option<[f32; 2]>>,
    pub set_layer: Mutex<Option<Option<usize>>>,
    pub hud_status: Mutex<crate::hud::HudStatus>,
    pub last_manual_layer: Mutex<Instant>,
    pub focus_ok: AtomicBool,
    pub foreground: Mutex<String>,
    pub reconnect: AtomicBool,
}

impl EngineCtl {
    pub fn new(cfg: EngineConfig) -> Arc<Self> {
        Arc::new(Self {
            config: ArcSwap::from_pointee(cfg),
            version: AtomicU64::new(1),
            snapshot: Mutex::new(Snapshot::default()),
            test_stick: Mutex::new(None),
            set_layer: Mutex::new(None),
            hud_status: Mutex::new(crate::hud::HudStatus::default()),
            last_manual_layer: Mutex::new(Instant::now() - Duration::from_secs(10)),
            focus_ok: AtomicBool::new(true),
            foreground: Mutex::new(String::new()),
            reconnect: AtomicBool::new(false),
        })
    }

    pub fn update(&self, cfg: EngineConfig) {
        self.config.store(Arc::new(cfg));
        self.version.fetch_add(1, Ordering::Release);
    }
}

type Entry = (Target, BindMode, usize, Option<String>);

struct CompiledLayer {
    name: String,
    activator: Option<u16>,
    mode: BindMode,
    aim_mult: Option<f32>,
    aim_target: Option<AimTarget>,
    map: Vec<Vec<Entry>>,
}

struct Compiled {
    base: Vec<Vec<Entry>>,
    layers: Vec<CompiledLayer>,
    targets: Vec<Target>,
    is_activator: [bool; SOURCE_COUNT],
}

fn compile(p: &Profile) -> Compiled {
    let mut targets = Vec::new();
    let mut add = |map: &mut Vec<Vec<Entry>>, bs: &[Binding]| {
        for b in bs {
            if let Some(c) = name_to_code(&b.source) {
                map[c as usize].push((b.target, b.mode, targets.len(), b.switch_layer.clone()));
                targets.push(b.target);
            }
        }
    };
    let mut base = vec![Vec::new(); SOURCE_COUNT];
    add(&mut base, &p.bindings);
    let mut is_activator = [false; SOURCE_COUNT];
    let layers = p
        .layers
        .iter()
        .map(|l| {
            let mut map = vec![Vec::new(); SOURCE_COUNT];
            add(&mut map, &l.bindings);
            let activator = name_to_code(&l.activator);
            if let Some(a) = activator {
                is_activator[a as usize] = true;
            }
            CompiledLayer {
                name: l.name.clone(),
                activator,
                mode: l.mode,
                aim_mult: l.aim_multiplier,
                aim_target: l.aim_target,
                map,
            }
        })
        .collect();
    Compiled { base, layers, targets, is_activator }
}

struct Engine {
    shared: Arc<Shared>,
    ctl: Arc<EngineCtl>,
    cfg: Arc<EngineConfig>,
    comp: Compiled,
    version: u64,
    held: [bool; SOURCE_COUNT],
    latched_hold: [Option<Target>; SOURCE_COUNT],
    seq: [u64; SOURCE_COUNT],
    seq_counter: u64,
    wheel_until: [Option<Instant>; 2],
    layer_on: Vec<bool>,
    prev_layer: Option<usize>,
    bind_on: Vec<bool>,
    aim: AimProcessor,
    aim_out: [f32; 2],
    dither: [f32; 4],
    output: Output,
    last_q: Option<Quantized>,
    active: bool,
    epoch: Instant,
    // stats
    key_lat: f32,
    mouse_lat: f32,
    submits: u32,
    ticks: u32,
    stat_t: Instant,
    submit_hz: f32,
    tick_hz: f32,
    snap_t: Instant,
}

impl Engine {
    fn reload(&mut self) {
        let v = self.ctl.version.load(Ordering::Acquire);
        if v == self.version {
            return;
        }
        self.version = v;
        let new = self.ctl.config.load_full();
        let kind_changed = new.settings.controller != self.cfg.settings.controller;
        let profile_changed = new.profile.id != self.cfg.profile.id;
        self.cfg = new;
        self.comp = compile(&self.cfg.profile);
        self.layer_on.resize(self.comp.layers.len(), false);
        self.bind_on = vec![false; self.comp.targets.len()];
        if profile_changed {
            self.layer_on.iter_mut().for_each(|l| *l = false);
            self.prev_layer = None;
            self.latched_hold = [None; SOURCE_COUNT];
        }
        let s = &self.cfg.settings;
        self.shared
            .toggle_key
            .store(name_to_code(&s.toggle_key).unwrap_or(0x77), Ordering::Relaxed);
        self.shared.hold_release_key.store(
            if s.hold_release_key.trim().is_empty() {
                0
            } else {
                name_to_code(&s.hold_release_key).unwrap_or(0)
            },
            Ordering::Relaxed,
        );
        self.shared.block_mouse_move.store(s.block_input, Ordering::Relaxed);
        if kind_changed || !self.output.connected() {
            self.output.connect(s.controller);
            self.last_q = None;
        }
    }

    fn pressed(&self, code: usize, now: Instant) -> bool {
        if code == WHEEL_UP as usize || code == WHEEL_DOWN as usize {
            self.wheel_until[code - WHEEL_UP as usize].map_or(false, |t| now < t)
        } else {
            self.held[code]
        }
    }

    fn active_layers(&self) -> Vec<usize> {
        self.comp
            .layers
            .iter()
            .enumerate()
            .filter(|(i, l)| match l.mode {
                BindMode::Hold => l.activator.map_or(false, |a| self.held[a as usize]),
                BindMode::Toggle => self.layer_on[*i],
            })
            .map(|(i, _)| i)
            .collect()
    }

    fn entries<'a>(&'a self, code: usize, layers: &[usize]) -> &'a [Entry] {
        for &li in layers.iter().rev() {
            let m = &self.comp.layers[li].map[code];
            if !m.is_empty() {
                return m;
            }
        }
        &self.comp.base[code]
    }

    fn switch_to_layer(&mut self, target_idx: Option<usize>, now: Instant, manual: bool) {
        if let Some(cur) = self.layer_on.iter().position(|&on| on) {
            let cur_name = self.comp.layers[cur].name.as_str();
            if !cur_name.eq_ignore_ascii_case("Menu") && !cur_name.eq_ignore_ascii_case("Map") {
                self.prev_layer = Some(cur);
            }
        }
        for oi in 0..self.comp.layers.len() {
            if self.comp.layers[oi].mode == BindMode::Toggle {
                self.layer_on[oi] = false;
            }
        }
        if let Some(idx) = target_idx {
            if idx < self.layer_on.len() {
                self.layer_on[idx] = true;
            }
        }
        self.aim.reset();
        self.aim_out = [0.0; 2];
        if manual {
            *self.ctl.last_manual_layer.lock() = now;
        }
    }

    fn on_down(&mut self, code: u16, now: Instant) {
        let i = code as usize;
        if i >= SOURCE_COUNT {
            return;
        }
        if code == WHEEL_UP || code == WHEEL_DOWN {
            let ms = self.cfg.profile.movement.wheel_pulse_ms.max(10.0);
            self.wheel_until[i - WHEEL_UP as usize] = Some(now + Duration::from_secs_f32(ms / 1000.0));
        } else {
            self.held[i] = true;
        }
        self.seq_counter += 1;
        self.seq[i] = self.seq_counter;

        // Mutually exclusive toggle layers (activating one turns off other toggle layers; pressing it again returns to Base).
        for li in 0..self.comp.layers.len() {
            let l = &self.comp.layers[li];
            if l.activator == Some(code) && l.mode == BindMode::Toggle {
                let next = !self.layer_on[li];
                self.switch_to_layer(if next { Some(li) } else { None }, now, true);
            }
        }

        // Toggle bindings & smart switch_layer triggers.
        let layers = self.active_layers();
        let mut toggles: Vec<usize> = Vec::new();
        let mut switch_req: Option<String> = None;
        let mut first_hold: Option<Target> = None;
        for (t, mode, id, sw) in self.entries(i, &layers) {
            if *mode == BindMode::Toggle {
                toggles.push(*id);
            } else if first_hold.is_none() {
                first_hold = Some(*t);
            }
            if switch_req.is_none() {
                if let Some(s) = sw {
                    switch_req = Some(s.clone());
                }
            }
        }
        for id in toggles {
            self.bind_on[id] = !self.bind_on[id];
        }
        if let Some(req) = switch_req {
            if code != WHEEL_UP && code != WHEEL_DOWN {
                // Latch the emitted Hold target across the layer transition until key release.
                self.latched_hold[i] = first_hold;
            }
            let target_idx = if req == "__base__" {
                None
            } else if req == "__prev__" {
                self.prev_layer
            } else {
                self.comp
                    .layers
                    .iter()
                    .position(|l| l.name.eq_ignore_ascii_case(&req))
            };
            self.switch_to_layer(target_idx, now, true);
        }
    }

    fn compute(&self, now: Instant) -> (PadState, f32, Vec<usize>) {
        let layers = self.active_layers();
        let mut pad = PadState::default();
        let mut dirs = [[0u64; 4]; 2]; // [stick][up, down, left, right]
        let mut walk = false;
        let mut feather = false;
        let mut apply = |t: Target, seq: u64, pad: &mut PadState| {
            use Target::*;
            if let Some(bit) = t.button_bit() {
                pad.buttons |= 1 << bit;
                return;
            }
            match t {
                L2 => pad.l2 = 1.0,
                R2 => pad.r2 = 1.0,
                LsUp => dirs[0][0] = dirs[0][0].max(seq),
                LsDown => dirs[0][1] = dirs[0][1].max(seq),
                LsLeft => dirs[0][2] = dirs[0][2].max(seq),
                LsRight => dirs[0][3] = dirs[0][3].max(seq),
                RsUp => dirs[1][0] = dirs[1][0].max(seq),
                RsDown => dirs[1][1] = dirs[1][1].max(seq),
                RsLeft => dirs[1][2] = dirs[1][2].max(seq),
                RsRight => dirs[1][3] = dirs[1][3].max(seq),
                Walk => walk = true,
                Feather => feather = true,
                _ => {}
            }
        };
        for code in 0..SOURCE_COUNT {
            if self.comp.is_activator[code] || !self.pressed(code, now) {
                continue;
            }
            if let Some(t) = self.latched_hold[code] {
                apply(t, self.seq[code].max(1), &mut pad);
                continue;
            }
            for (t, mode, _, _) in self.entries(code, &layers) {
                if *mode == BindMode::Hold {
                    apply(*t, self.seq[code].max(1), &mut pad);
                }
            }
        }
        for (id, on) in self.bind_on.iter().enumerate() {
            if *on {
                apply(self.comp.targets[id], 1, &mut pad);
            }
        }

        let socd = self.cfg.profile.movement.socd;
        let axis = |neg: u64, pos: u64| -> f32 {
            match (neg > 0, pos > 0) {
                (true, true) => match socd {
                    Socd::Neutral => 0.0,
                    Socd::LastWins => {
                        if pos > neg {
                            1.0
                        } else {
                            -1.0
                        }
                    }
                },
                (true, false) => -1.0,
                (false, true) => 1.0,
                _ => 0.0,
            }
        };
        let stick = |d: [u64; 4]| -> (f32, f32) {
            let x = axis(d[2], d[3]);
            let y = axis(d[1], d[0]);
            let m = (x * x + y * y).sqrt();
            if m > 1.0 {
                (x / m, y / m)
            } else {
                (x, y)
            }
        };
        let (mut lx, mut ly) = stick(dirs[0]);
        if walk {
            let w = self.cfg.profile.movement.walk_scale.clamp(0.05, 1.0);
            lx *= w;
            ly *= w;
        }
        if feather {
            let f = self.cfg.profile.movement.feather_scale.clamp(0.1, 0.95);
            pad.l2 *= f;
            pad.r2 *= f;
        }
        let (rx, ry) = stick(dirs[1]);
        pad.lx = lx;
        pad.ly = ly;
        pad.rx = rx;
        pad.ry = ry;

        // Aim multiplier: topmost active layer override, else ADS while L2 is held.
        let mut mult = if pad.l2 > 0.0 { self.cfg.profile.aim.ads_multiplier } else { 1.0 };
        for &li in layers.iter().rev() {
            if let Some(m) = self.comp.layers[li].aim_mult {
                mult = m;
                break;
            }
        }
        (pad, mult, layers)
    }

    fn quantize(&mut self, pad: &PadState, dither_axes: [bool; 4]) -> Quantized {
        let levels = self.output.stick_levels();
        let vals = [pad.lx, pad.ly, pad.rx, pad.ry];
        let mut sticks = [0i32; 4];
        for i in 0..4 {
            let v = vals[i].clamp(-1.0, 1.0);
            if v == 0.0 {
                self.dither[i] = 0.0;
                continue;
            }
            let x = v * levels;
            sticks[i] = if dither_axes[i] {
                let t = x + self.dither[i];
                let r = t.round().clamp(-levels, levels);
                self.dither[i] = (t - r).clamp(-1.0, 1.0);
                r as i32
            } else {
                x.round() as i32
            };
        }
        Quantized {
            buttons: pad.buttons,
            sticks,
            l2: (pad.l2.clamp(0.0, 1.0) * 255.0).round() as u8,
            r2: (pad.r2.clamp(0.0, 1.0) * 255.0).round() as u8,
        }
    }

    fn run(mut self) {
        unsafe {
            SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_TIME_CRITICAL);
        }
        let timer = unsafe {
            CreateWaitableTimerExW(
                std::ptr::null(),
                std::ptr::null(),
                CREATE_WAITABLE_TIMER_HIGH_RESOLUTION,
                TIMER_ALL_ACCESS,
            )
        };
        let handles = [self.shared.wake_handle(), timer];
        let mut next_tick = Instant::now();
        let mut last_aim_t = Instant::now();
        let mut timer_armed = false;
        let mut pending_key: Option<Instant> = None;
        let mut pending_mouse: Option<Instant> = None;

        loop {
            if !timer_armed {
                let rem = next_tick.saturating_duration_since(Instant::now());
                let due: i64 = -((rem.as_nanos() / 100) as i64).max(1);
                unsafe { SetWaitableTimer(timer, &due, 0, None, std::ptr::null(), 0) };
                timer_armed = true;
            }
            let r = unsafe { WaitForMultipleObjects(2, handles.as_ptr(), 0, 50) };
            let now = Instant::now();
            if r == WAIT_OBJECT_0 + 1 {
                timer_armed = false;
            }

            if self.ctl.reconnect.swap(false, Ordering::AcqRel) {
                self.output.connect(self.cfg.settings.controller);
                self.last_q = None;
            }
            self.reload();

            let layer_req = self.ctl.set_layer.lock().take();
            if let Some(target_layer) = layer_req {
                self.switch_to_layer(target_layer, now, false);
            }

            // Input events.
            while let Some(e) = self.shared.events.pop() {
                match e {
                    InputEvent::Down(c, t) => {
                        self.on_down(c, t);
                        pending_key.get_or_insert(t);
                    }
                    InputEvent::Up(c, t) => {
                        if (c as usize) < SOURCE_COUNT {
                            self.held[c as usize] = false;
                            self.latched_hold[c as usize] = None;
                        }
                        pending_key.get_or_insert(t);
                    }
                    InputEvent::ToggleArmed => {}
                }
            }
            while let Some((t, dx, dy)) = self.shared.mouse.pop() {
                self.aim.push((t - self.epoch).as_secs_f64(), dx as f32, dy as f32);
                pending_mouse.get_or_insert(t);
            }

            // Aim tick.
            let hz = self.cfg.settings.output_hz.clamp(125, 8000) as f64;
            let period = Duration::from_secs_f64(1.0 / hz);
            let tick = now >= next_tick;
            let (pad0, mult, layers) = self.compute(now);
            let mut aim_t = self.cfg.profile.aim.target;
            for &li in layers.iter().rev() {
                if let Some(t) = self.comp.layers[li].aim_target {
                    aim_t = t;
                    break;
                }
            }
            if layers.is_empty() && self.cfg.profile.id == "gta6" {
                aim_t = AimTarget::Off;
            }
            if tick {
                let dt = (now - last_aim_t).as_secs_f64().clamp(1e-5, 0.05);
                last_aim_t = now;
                let s = &self.cfg.profile.aim;
                self.aim_out = if aim_t == AimTarget::Off {
                    self.aim.reset();
                    [0.0; 2]
                } else {
                    let t = (now - self.epoch).as_secs_f64();
                    let s = s.clone();
                    self.aim.process(t, dt, &s, mult)
                };
                self.ticks += 1;
                next_tick += period;
                if next_tick < now {
                    next_tick = now + period;
                }
                if !timer_armed {
                    // timer consumed; will re-arm at loop top
                }
            }

            let mut pad = pad0;
            let mut dither_axes = [false; 4];
            let add = |x: &mut f32, y: &mut f32, a: [f32; 2]| {
                *x += a[0];
                *y += a[1];
                let m = (*x * *x + *y * *y).sqrt();
                if m > 1.0 {
                    *x /= m;
                    *y /= m;
                }
            };
            match aim_t {
                AimTarget::RightStick => {
                    add(&mut pad.rx, &mut pad.ry, self.aim_out);
                    dither_axes[2] = self.cfg.profile.aim.dithering;
                    dither_axes[3] = self.cfg.profile.aim.dithering;
                }
                AimTarget::LeftStick => {
                    add(&mut pad.lx, &mut pad.ly, self.aim_out);
                    dither_axes[0] = self.cfg.profile.aim.dithering;
                    dither_axes[1] = self.cfg.profile.aim.dithering;
                }
                AimTarget::Off => {}
            }

            // Activity state.
            let s = &self.cfg.settings;
            let armed = self.shared.armed.load(Ordering::Acquire);
            let temp_released = self.shared.hold_release_down.load(Ordering::Acquire);
            let focus_ok = !s.auto_focus || self.ctl.focus_ok.load(Ordering::Relaxed);
            let test = *self.ctl.test_stick.lock();
            let active = armed && focus_ok && !temp_released && self.output.connected();
            if active != self.active {
                self.active = active;
                self.shared.suppress.store(active && s.block_input, Ordering::Release);
                if !active {
                    self.aim.reset();
                    self.aim_out = [0.0; 2];
                    self.dither = [0.0; 4];
                }
            }

            let send_pad = if active {
                Some(pad)
            } else if let Some(ts) = test {
                let mut p = PadState::default();
                match aim_t {
                    AimTarget::LeftStick => {
                        p.lx = ts[0];
                        p.ly = ts[1];
                    }
                    _ => {
                        p.rx = ts[0];
                        p.ry = ts[1];
                    }
                }
                Some(p)
            } else {
                Some(PadState::default())
            };

            if let Some(sp) = send_pad {
                let q = self.quantize(&sp, dither_axes);
                if self.last_q != Some(q) && self.output.connected() {
                    if self.output.submit(&q) {
                        self.last_q = Some(q);
                        self.submits += 1;
                        let done = Instant::now();
                        if active {
                            if let Some(t) = pending_key.take() {
                                let us = (done - t).as_secs_f32() * 1e6;
                                if self.key_lat == 0.0 {
                                    self.key_lat = us;
                                } else {
                                    self.key_lat += (us - self.key_lat) * 0.15;
                                }
                            }
                            if let Some(t) = pending_mouse.take() {
                                let us = (done - t).as_secs_f32() * 1e6;
                                if self.mouse_lat == 0.0 {
                                    self.mouse_lat = us;
                                } else {
                                    self.mouse_lat += (us - self.mouse_lat) * 0.05;
                                }
                            }
                        }
                    } else {
                        self.output.disconnect();
                    }
                }
            }
            if tick {
                pending_mouse = None;
            }
            pending_key = None;

            // Stats + UI snapshot (~120 Hz).
            if now - self.stat_t >= Duration::from_secs(1) {
                let secs = (now - self.stat_t).as_secs_f32();
                self.submit_hz = self.submits as f32 / secs;
                self.tick_hz = self.ticks as f32 / secs;
                self.submits = 0;
                self.ticks = 0;
                self.stat_t = now;
            }
            if now - self.snap_t >= Duration::from_millis(8) {
                self.snap_t = now;
                let preview = if !active {
                    if let Some(ts) = test {
                        let mut p = pad;
                        match aim_t {
                            AimTarget::LeftStick => {
                                p.lx = ts[0];
                                p.ly = ts[1];
                            }
                            _ => {
                                p.rx = ts[0];
                                p.ry = ts[1];
                            }
                        }
                        p
                    } else {
                        pad
                    }
                } else {
                    pad
                };
                let hs = self.ctl.hud_status.lock().clone();
                let snap = Snapshot {
                    pad: preview,
                    active,
                    armed,
                    temp_released,
                    focus_ok,
                    connected: self.output.connected(),
                    driver_error: self.output.error.clone(),
                    controller: self.output.kind,
                    key_latency_us: self.key_lat,
                    mouse_latency_us: self.mouse_lat,
                    mouse_hz: self.aim.polling_hz(),
                    submit_hz: self.submit_hz,
                    tick_hz: self.tick_hz,
                    layers: layers.iter().map(|&i| self.comp.layers[i].name.clone()).collect(),
                    foreground: self.ctl.foreground.lock().clone(),
                    profile: self.cfg.profile.name.clone(),
                    hud_match: hs.active_match,
                    hud_scores: hs.scores,
                };
                *self.ctl.snapshot.lock() = snap;
            }
        }
    }
}

pub fn start(shared: Arc<Shared>, ctl: Arc<EngineCtl>) {
    std::thread::Builder::new()
        .name("kbm-engine".into())
        .spawn(move || {
            let cfg = ctl.config.load_full();
            let comp = compile(&cfg.profile);
            let now = Instant::now();
            let mut e = Engine {
                layer_on: vec![false; comp.layers.len()],
                bind_on: vec![false; comp.targets.len()],
                comp,
                shared,
                ctl: ctl.clone(),
                cfg,
                version: 0,
                held: [false; SOURCE_COUNT],
                latched_hold: [None; SOURCE_COUNT],
                seq: [0; SOURCE_COUNT],
                seq_counter: 0,
                wheel_until: [None; 2],
                prev_layer: None,
                aim: AimProcessor::default(),
                aim_out: [0.0; 2],
                dither: [0.0; 4],
                output: Output::new(),
                last_q: None,
                active: false,
                epoch: now,
                key_lat: 0.0,
                mouse_lat: 0.0,
                submits: 0,
                ticks: 0,
                stat_t: now,
                submit_hz: 0.0,
                tick_hz: 0.0,
                snap_t: now,
            };
            let kind = e.cfg.settings.controller;
            e.output.connect(kind);
            e.version = ctl.version.load(Ordering::Acquire);
            e.shared.toggle_key.store(
                name_to_code(&e.cfg.settings.toggle_key).unwrap_or(0x77),
                Ordering::Relaxed,
            );
            e.shared.hold_release_key.store(
                if e.cfg.settings.hold_release_key.trim().is_empty() {
                    0
                } else {
                    name_to_code(&e.cfg.settings.hold_release_key).unwrap_or(0)
                },
                Ordering::Relaxed,
            );
            e.shared.block_mouse_move.store(e.cfg.settings.block_input, Ordering::Relaxed);
            e.run();
        })
        .expect("engine thread");
}
