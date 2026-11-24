//! Low-level input capture.
//!
//! * Keyboard + mouse buttons/wheel: WH_KEYBOARD_LL / WH_MOUSE_LL hooks. They are called
//!   synchronously by the system input thread, so events arrive with no polling delay and can be
//!   blocked from reaching other applications while capture is active.
//! * Mouse movement: Raw Input (RIDEV_INPUTSINK) — raw, unaccelerated sensor counts at the full
//!   mouse polling rate, independent of Windows pointer speed / "enhance pointer precision".
//!
//! Everything runs on one dedicated time-critical thread with its own message loop. Events are
//! handed to the engine through lock-free queues and a kernel event that wakes it instantly.

use crate::keys::*;
use crossbeam_queue::ArrayQueue;
use parking_lot::Mutex;
use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU16, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Arc;
use std::time::Instant;
use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::Threading::*;
use windows_sys::Win32::UI::Input::*;
use windows_sys::Win32::UI::WindowsAndMessaging::*;

#[derive(Clone, Copy, Debug)]
pub enum InputEvent {
    Down(u16, Instant),
    Up(u16, Instant),
    ToggleArmed,
}

pub struct Shared {
    pub events: ArrayQueue<InputEvent>,
    pub mouse: ArrayQueue<(Instant, i32, i32)>,
    wake: AtomicIsize,
    /// Block bound input from reaching other apps (set by the engine while active).
    pub suppress: AtomicBool,
    pub block_mouse_move: AtomicBool,
    pub armed: AtomicBool,
    pub toggle_key: AtomicU16,
    pub hold_release_key: AtomicU16,
    pub hold_release_down: AtomicBool,
    pub bind_listen: AtomicBool,
    pub bind_tx: Mutex<Option<Sender<String>>>,
}

impl Shared {
    pub fn new() -> Arc<Self> {
        let wake = unsafe { windows_sys::Win32::System::Threading::CreateEventW(std::ptr::null(), 0, 0, std::ptr::null()) };
        Arc::new(Self {
            events: ArrayQueue::new(4096),
            mouse: ArrayQueue::new(65536),
            wake: AtomicIsize::new(wake as isize),
            suppress: AtomicBool::new(false),
            block_mouse_move: AtomicBool::new(false),
            armed: AtomicBool::new(false),
            toggle_key: AtomicU16::new(0x77),
            hold_release_key: AtomicU16::new(0xA5), // RAlt
            hold_release_down: AtomicBool::new(false),
            bind_listen: AtomicBool::new(false),
            bind_tx: Mutex::new(None),
        })
    }

    pub fn wake_handle(&self) -> HANDLE {
        self.wake.load(Ordering::Relaxed) as HANDLE
    }

    pub fn push(&self, e: InputEvent) {
        let _ = self.events.push(e);
        unsafe { SetEvent(self.wake_handle()) };
    }
}

static SHARED: std::sync::OnceLock<Arc<Shared>> = std::sync::OnceLock::new();

struct HookState {
    held: [bool; SOURCE_COUNT],
    passed: [bool; SOURCE_COUNT],
    bind_swallow: [bool; SOURCE_COUNT],
}

thread_local! {
    static HS: RefCell<HookState> = const { RefCell::new(HookState {
        held: [false; SOURCE_COUNT],
        passed: [true; SOURCE_COUNT],
        bind_swallow: [false; SOURCE_COUNT],
    }) };
}

/// Keys that are never blocked so the user can always get out (Win key, Alt+Tab).
fn always_pass(code: u16, hs: &HookState) -> bool {
    matches!(code, 0x5B | 0x5C) || (code == 0x09 && (hs.held[0xA4] || hs.held[0xA5]))
}

/// Returns true if the event should be swallowed.
fn handle(code: u16, down: bool) -> bool {
    let Some(sh) = SHARED.get() else { return false };
    let now = Instant::now();
    HS.with(|hs| {
        let hs = &mut *hs.borrow_mut();
        let i = code as usize;
        let is_wheel = code == WHEEL_UP || code == WHEEL_DOWN;
        let edge = is_wheel || hs.held[i] != down;
        if !is_wheel {
            hs.held[i] = down;
        }

        // Key binding capture for the UI.
        if down && edge && sh.bind_listen.swap(false, Ordering::AcqRel) {
            if let Some(tx) = sh.bind_tx.lock().as_ref() {
                let _ = tx.send(code_to_name(code));
            }
            hs.bind_swallow[i] = !is_wheel;
            return true;
        }
        if hs.bind_swallow[i] {
            if !down {
                hs.bind_swallow[i] = false;
            }
            return true;
        }

        // Capture on/off hotkey.
        if code == sh.toggle_key.load(Ordering::Relaxed) {
            if down && edge {
                sh.armed.fetch_xor(true, Ordering::AcqRel);
                sh.push(InputEvent::ToggleArmed);
            }
            return true;
        }

        // Hold-to-temporarily-release cursor/keys back to Windows.
        let hrk = sh.hold_release_key.load(Ordering::Relaxed);
        if hrk != 0 && code == hrk {
            if edge {
                sh.hold_release_down.store(down, Ordering::Release);
                sh.push(InputEvent::ToggleArmed);
            }
            return false;
        }

        if edge {
            sh.push(if down { InputEvent::Down(code, now) } else { InputEvent::Up(code, now) });
        }

        if is_wheel {
            return sh.suppress.load(Ordering::Relaxed);
        }
        if down {
            if edge {
                let block = sh.suppress.load(Ordering::Relaxed) && !always_pass(code, hs);
                hs.passed[i] = !block;
                block
            } else {
                !hs.passed[i] // auto-repeat follows the decision of the first press
            }
        } else {
            let block = !hs.passed[i];
            hs.passed[i] = true;
            block
        }
    })
}

unsafe extern "system" fn kb_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 {
        let k = &*(lparam as *const KBDLLHOOKSTRUCT);
        if k.flags & LLKHF_INJECTED == 0 && k.vkCode < 256 {
            let down = wparam as u32 == WM_KEYDOWN || wparam as u32 == WM_SYSKEYDOWN;
            if handle(k.vkCode as u16, down) {
                return 1;
            }
        }
    }
    CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
}

unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 {
        let m = &*(lparam as *const MSLLHOOKSTRUCT);
        if m.flags & LLMHF_INJECTED == 0 {
            let hi = (m.mouseData >> 16) as u16;
            let ev = match wparam as u32 {
                WM_LBUTTONDOWN => Some((M_LEFT, true)),
                WM_LBUTTONUP => Some((M_LEFT, false)),
                WM_RBUTTONDOWN => Some((M_RIGHT, true)),
                WM_RBUTTONUP => Some((M_RIGHT, false)),
                WM_MBUTTONDOWN => Some((M_MIDDLE, true)),
                WM_MBUTTONUP => Some((M_MIDDLE, false)),
                WM_XBUTTONDOWN => Some((if hi == 1 { M_X1 } else { M_X2 }, true)),
                WM_XBUTTONUP => Some((if hi == 1 { M_X1 } else { M_X2 }, false)),
                WM_MOUSEWHEEL => Some((if (hi as i16) > 0 { WHEEL_UP } else { WHEEL_DOWN }, true)),
                WM_MOUSEMOVE => {
                    if let Some(sh) = SHARED.get() {
                        if sh.suppress.load(Ordering::Relaxed) && sh.block_mouse_move.load(Ordering::Relaxed) {
                            return 1;
                        }
                    }
                    None
                }
                _ => None,
            };
            if let Some((c, down)) = ev {
                if handle(c, down) {
                    return 1;
                }
            }
        }
    }
    CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
}

unsafe extern "system" fn wnd_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if msg == WM_INPUT {
        let mut buf = [0u8; 64];
        let mut size = buf.len() as u32;
        let n = GetRawInputData(
            lparam as HRAWINPUT,
            RID_INPUT,
            buf.as_mut_ptr() as *mut _,
            &mut size,
            std::mem::size_of::<RAWINPUTHEADER>() as u32,
        );
        if n != u32::MAX && n as usize >= std::mem::size_of::<RAWINPUTHEADER>() {
            let raw = &*(buf.as_ptr() as *const RAWINPUT);
            if raw.header.dwType == RIM_TYPEMOUSE {
                let m = &raw.data.mouse;
                if m.usFlags as u32 & MOUSE_MOVE_ABSOLUTE as u32 == 0 && (m.lLastX != 0 || m.lLastY != 0) {
                    if let Some(sh) = SHARED.get() {
                        let _ = sh.mouse.push((Instant::now(), m.lLastX, m.lLastY));
                    }
                }
            }
        }
    }
    DefWindowProcW(hwnd, msg, wparam, lparam)
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Spawns the input thread. Must be called once.
pub fn start(shared: Arc<Shared>) {
    let _ = SHARED.set(shared);
    std::thread::Builder::new()
        .name("kbm-input".into())
        .spawn(|| unsafe {
            SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_TIME_CRITICAL);
            let hinst = GetModuleHandleW(std::ptr::null());
            let class = wide("KBMBridgeRawInput");
            let wc = WNDCLASSW {
                style: 0,
                lpfnWndProc: Some(wnd_proc),
                cbClsExtra: 0,
                cbWndExtra: 0,
                hInstance: hinst,
                hIcon: std::ptr::null_mut(),
                hCursor: std::ptr::null_mut(),
                hbrBackground: std::ptr::null_mut(),
                lpszMenuName: std::ptr::null(),
                lpszClassName: class.as_ptr(),
            };
            RegisterClassW(&wc);
            let hwnd = CreateWindowExW(
                0,
                class.as_ptr(),
                class.as_ptr(),
                0,
                0,
                0,
                0,
                0,
                HWND_MESSAGE,
                std::ptr::null_mut(),
                hinst,
                std::ptr::null(),
            );
            let rid = RAWINPUTDEVICE {
                usUsagePage: 0x01,
                usUsage: 0x02,
                dwFlags: RIDEV_INPUTSINK,
                hwndTarget: hwnd,
            };
            RegisterRawInputDevices(&rid, 1, std::mem::size_of::<RAWINPUTDEVICE>() as u32);

            SetWindowsHookExW(WH_KEYBOARD_LL, Some(kb_proc), hinst, 0);
            SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), hinst, 0);

            let mut msg: MSG = std::mem::zeroed();
            while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        })
        .expect("input thread");
}
