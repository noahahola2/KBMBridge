# KBMBridge

Low-latency keyboard & mouse to virtual controller bridge for Windows (PlayStation / Xbox), built with **Tauri + Rust** and **React + TypeScript**.

## Highlights

- **Ultra-low-latency Rust core**: Dedicated `THREAD_PRIORITY_TIME_CRITICAL` Raw Input & hook capture thread + lock-free ring buffers + kernel-event instant wake for key presses + 1000 Hz high-resolution waitable timer + EcoQoS opt-out.
- **High-precision mouse → stick translation**:
  - Triangular-weighted adaptive velocity estimation (fast flick stops, zero polling-rate aliasing across 125–8000 Hz mice)
  - Response curve linearization (Exponent or draggable custom Fritsch–Carlson monotone cubic spline)
  - Radial / Axial anti-deadzone, initial boost, outer cap, optional overflow carry, and temporal error-diffusion dithering (sub-step precision on 8-bit DS4 sticks)
  - Live in-game Deadzone Calibration test stick
- **PS5 / PlayStation (DS4) & Xbox 360** virtual controller output via ViGEmBus.
- **Standalone & Companion App Modes**: Run as Controller Only, or auto-pair window focus with **Veyra**, **PushFPS**, **Remote Play** (`chiaki-ng`, PS Remote Play, Xbox App), or any custom app. Designed for Remote Play today with Capture Card workflow ready for future hardware bridge output.
- **Game Profiles & Layers**: Pre-configured **GTA VI** profile (On-Foot + toggleable `Vehicle` layer), custom profile creation, custom input additions, and Hold/Toggle modes.

## Prerequisites

1. **ViGEmBus Driver** (required once for Windows virtual PlayStation / Xbox controllers):
   Download the latest installer from [ViGEmBus Releases](https://github.com/nefarius/ViGEmBus/releases/latest).
2. **Rust & Node.js** (for building from source).

## Development & Build

```powershell
# Run in development mode
npm.cmd run tauri dev

# Build production executable / installer
npm.cmd run tauri build
```
