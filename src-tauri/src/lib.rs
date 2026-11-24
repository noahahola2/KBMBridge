mod aim;
mod engine;
mod hud;
mod input;
mod keys;
mod output;
mod profile;
mod store;

use engine::{EngineConfig, EngineCtl};
use input::Shared;
use parking_lot::Mutex;
use profile::{Profile, Settings};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;
use store::Store;
use tauri::{Emitter, Manager, State};
use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::System::Threading::*;
use windows_sys::Win32::UI::WindowsAndMessaging::*;

struct App {
    shared: Arc<Shared>,
    ctl: Arc<EngineCtl>,
    store: Arc<Mutex<Store>>,
}

impl App {
    fn push(&self) {
        let st = self.store.lock();
        self.ctl.update(EngineConfig { settings: st.settings.clone(), profile: st.active() });
        self.shared.push(input::InputEvent::ToggleArmed); // wake engine
    }
}

#[derive(Serialize)]
struct Bootstrap {
    settings: Settings,
    profiles: Vec<Profile>,
    key_labels: HashMap<String, String>,
}

#[tauri::command]
fn bootstrap(app: State<'_, App>) -> Bootstrap {
    let st = app.store.lock();
    Bootstrap {
        settings: st.settings.clone(),
        profiles: st.profiles.clone(),
        key_labels: keys::layout_labels().into_iter().collect(),
    }
}

#[tauri::command]
fn save_settings(app: State<'_, App>, mut settings: Settings) -> Result<(), String> {
    if matches!(settings.toggle_key.as_str(), "Mouse1" | "Mouse2") {
        settings.toggle_key = "F8".into();
    }
    if matches!(settings.hold_release_key.as_str(), "Mouse1" | "Mouse2") {
        settings.hold_release_key = "RAlt".into();
    }
    {
        let mut st = app.store.lock();
        st.settings = settings;
        st.save_settings()?;
        apply_process_priority(st.settings.high_priority);
    }
    app.push();
    Ok(())
}

#[tauri::command]
fn create_profile(app: State<'_, App>, name: String, game: String) -> Result<Profile, String> {
    let slug: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let id = format!("{}-{}", slug.trim_matches('-'), ts % 100000);
    let mut p = profile::blank_profile(&id, name.trim());
    p.game = game.trim().to_string();
    {
        let mut st = app.store.lock();
        st.save_profile(p.clone())?;
        st.settings.active_profile = p.id.clone();
        st.save_settings()?;
    }
    app.push();
    Ok(p)
}

#[tauri::command]
fn save_profile(app: State<'_, App>, profile: Profile) -> Result<(), String> {
    app.store.lock().save_profile(profile)?;
    app.push();
    Ok(())
}

#[tauri::command]
fn delete_profile(app: State<'_, App>, id: String) -> Result<Vec<Profile>, String> {
    let profiles = {
        let mut st = app.store.lock();
        st.delete_profile(&id)?;
        st.profiles.clone()
    };
    app.push();
    Ok(profiles)
}

#[tauri::command]
fn set_active_profile(app: State<'_, App>, id: String) -> Result<(), String> {
    {
        let mut st = app.store.lock();
        st.settings.active_profile = id;
        st.save_settings()?;
    }
    app.push();
    Ok(())
}

#[tauri::command]
fn set_armed(app: State<'_, App>, on: bool) {
    app.shared.armed.store(on, Ordering::Release);
    app.shared.push(input::InputEvent::ToggleArmed);
}

#[tauri::command]
fn start_bind(app: State<'_, App>) {
    app.shared.bind_listen.store(true, Ordering::Release);
}

#[tauri::command]
fn cancel_bind(app: State<'_, App>) {
    app.shared.bind_listen.store(false, Ordering::Release);
}

#[tauri::command]
fn set_test_stick(app: State<'_, App>, value: Option<[f32; 2]>) {
    *app.ctl.test_stick.lock() = value;
    app.shared.push(input::InputEvent::ToggleArmed);
}

#[tauri::command]
fn set_active_layer(app: State<'_, App>, index: Option<usize>) {
    *app.ctl.set_layer.lock() = Some(index);
    app.shared.push(input::InputEvent::ToggleArmed);
}

#[tauri::command]
async fn capture_hud_sample(
    zone: profile::HudZone,
    delay_ms: u64,
) -> Result<profile::HudSample, String> {
    tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(Duration::from_millis(delay_ms.min(8000)));
        unsafe {
            let own_pid = GetCurrentProcessId();
            let fg = GetForegroundWindow();
            let mut pid = 0u32;
            GetWindowThreadProcessId(fg, &mut pid);
            if fg.is_null() || pid == own_pid || pid == 0 {
                return Err(
                    "Switch to your game or stream window before the countdown ends.".into(),
                );
            }
            let rgb = hud::capture_zone(fg, zone)
                .ok_or_else(|| "Could not capture the foreground window.".to_string())?;
            Ok(profile::HudSample { rgb })
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn reconnect_controller(app: State<'_, App>) {
    app.ctl.reconnect.store(true, Ordering::Release);
    app.shared.push(input::InputEvent::ToggleArmed);
}

#[derive(Serialize)]
struct AppWindow {
    exe: String,
    title: String,
}

#[tauri::command]
fn list_apps() -> Vec<AppWindow> {
    unsafe extern "system" fn cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let out = &mut *(lparam as *mut Vec<AppWindow>);
        if IsWindowVisible(hwnd) == 0 || GetWindowTextLengthW(hwnd) == 0 {
            return 1;
        }
        let mut buf = [0u16; 256];
        let n = GetWindowTextW(hwnd, buf.as_mut_ptr(), 256);
        let title = String::from_utf16_lossy(&buf[..n as usize]);
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if let Some(exe) = exe_name(pid) {
            if !out.iter().any(|w| w.exe.eq_ignore_ascii_case(&exe)) && pid != GetCurrentProcessId() {
                out.push(AppWindow { exe, title });
            }
        }
        1
    }
    let mut out: Vec<AppWindow> = Vec::new();
    unsafe { EnumWindows(Some(cb), &mut out as *mut _ as LPARAM) };
    out.retain(|w| {
        !matches!(
            w.exe.to_ascii_lowercase().as_str(),
            "explorer.exe" | "textinputhost.exe" | "applicationframehost.exe" | "kbmbridge.exe"
        )
    });
    out.sort_by(|a, b| a.exe.to_lowercase().cmp(&b.exe.to_lowercase()));
    out
}

fn exe_name(pid: u32) -> Option<String> {
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return None;
        }
        let mut buf = [0u16; 520];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, 0, buf.as_mut_ptr(), &mut len);
        CloseHandle(h);
        if ok == 0 {
            return None;
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        path.rsplit('\\').next().map(|s| s.to_string())
    }
}

fn apply_process_priority(high: bool) {
    unsafe {
        SetPriorityClass(
            GetCurrentProcess(),
            if high { HIGH_PRIORITY_CLASS } else { NORMAL_PRIORITY_CLASS },
        );
        // Opt out of EcoQoS / power throttling so timers stay precise in the background.
        let state = PROCESS_POWER_THROTTLING_STATE {
            Version: PROCESS_POWER_THROTTLING_CURRENT_VERSION,
            ControlMask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED
                | PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION,
            StateMask: 0,
        };
        SetProcessInformation(
            GetCurrentProcess(),
            ProcessPowerThrottling,
            &state as *const _ as *const _,
            std::mem::size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32,
        );
    }
}

/// Watches the foreground window (auto-pause when the game window is not focused, auto-switch
/// profiles matched by executable name) and keeps the cursor locked while capture is active.
fn start_watcher(
    ctl: Arc<EngineCtl>,
    shared: Arc<Shared>,
    store: Arc<Mutex<Store>>,
    handle: tauri::AppHandle,
) {
    std::thread::Builder::new()
        .name("kbm-watcher".into())
        .spawn(move || {
            let own_pid = unsafe { GetCurrentProcessId() };
            let mut last_pid = u32::MAX;
            let mut last_exe = String::new();
            let mut clipped = false;
            loop {
                std::thread::sleep(Duration::from_millis(25));
                let (video_app, lock_cursor) = {
                    let c = ctl.config.load();
                    (c.settings.video_app.trim().to_string(), c.settings.lock_cursor)
                };
                let fg = unsafe { GetForegroundWindow() };
                let mut pid = 0u32;
                unsafe { GetWindowThreadProcessId(fg, &mut pid) };
                if pid != last_pid {
                    last_pid = pid;
                    last_exe = exe_name(pid).unwrap_or_default();
                    *ctl.foreground.lock() = last_exe.clone();

                    // Auto-switch profile if any profile targets this executable.
                    if !last_exe.is_empty() && pid != own_pid {
                        let switched = {
                            let mut st = store.lock();
                            let target_id = st
                                .profiles
                                .iter()
                                .find(|p| {
                                    !p.auto_switch_app.trim().is_empty()
                                        && p.auto_switch_app
                                            .split(';')
                                            .any(|a| a.trim().eq_ignore_ascii_case(&last_exe))
                                })
                                .map(|p| p.id.clone());
                            if let Some(id) = target_id {
                                if st.settings.active_profile != id {
                                    st.settings.active_profile = id.clone();
                                    let _ = st.save_settings();
                                    ctl.update(EngineConfig {
                                        settings: st.settings.clone(),
                                        profile: st.active(),
                                    });
                                    shared.push(input::InputEvent::ToggleArmed);
                                    Some(id)
                                } else {
                                    None
                                }
                            } else {
                                None
                            }
                        };
                        if let Some(id) = switched {
                            let _ = handle.emit("profile-switched", id);
                        }
                    }
                }
                let ok = if video_app.is_empty() {
                    pid != own_pid && pid != 0
                } else {
                    video_app.split(';').any(|a| a.trim().eq_ignore_ascii_case(&last_exe))
                };
                ctl.focus_ok.store(ok, Ordering::Relaxed);

                let active = ctl.snapshot.lock().active;
                if active && lock_cursor && !fg.is_null() {
                    let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
                    if unsafe { GetWindowRect(fg, &mut r) } != 0 {
                        let cx = (r.left + r.right) / 2;
                        let cy = (r.top + r.bottom) / 2;
                        let clip = RECT { left: cx, top: cy, right: cx + 1, bottom: cy + 1 };
                        unsafe { ClipCursor(&clip) };
                        clipped = true;
                    }
                } else if clipped {
                    unsafe { ClipCursor(std::ptr::null()) };
                    clipped = false;
                }
            }
        })
        .expect("watcher thread");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    unsafe { windows_sys::Win32::Media::timeBeginPeriod(1) };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_config_dir().expect("config dir");
            let store = Store::load(dir);
            apply_process_priority(store.settings.high_priority);

            let shared = Shared::new();
            let ctl = EngineCtl::new(EngineConfig {
                settings: store.settings.clone(),
                profile: store.active(),
            });
            let store = Arc::new(Mutex::new(store));

            let (tx, rx) = std::sync::mpsc::channel::<String>();
            *shared.bind_tx.lock() = Some(tx);

            input::start(shared.clone());
            engine::start(shared.clone(), ctl.clone());
            hud::start(ctl.clone(), shared.clone());
            start_watcher(ctl.clone(), shared.clone(), store.clone(), app.handle().clone());

            // Bind capture -> UI
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                while let Ok(name) = rx.recv() {
                    let _ = handle.emit("bind-captured", name);
                }
            });

            // Live engine state -> UI (60 Hz)
            let handle = app.handle().clone();
            let c2 = ctl.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_millis(16));
                let snap = c2.snapshot.lock().clone();
                let _ = handle.emit("engine-state", snap);
            });

            app.manage(App { shared, ctl, store });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            save_settings,
            create_profile,
            save_profile,
            delete_profile,
            set_active_profile,
            set_armed,
            start_bind,
            cancel_bind,
            set_test_stick,
            set_active_layer,
            capture_hud_sample,
            reconnect_controller,
            list_apps
        ])
        .run(tauri::generate_context!())
        .expect("error while running KBMBridge");
}
