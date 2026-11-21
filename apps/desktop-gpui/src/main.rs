#[cfg(any(target_os = "windows", target_os = "linux"))]
mod app;
#[cfg(any(target_os = "windows", target_os = "linux"))]
mod copy;
#[cfg(any(target_os = "windows", target_os = "linux"))]
mod server;
#[cfg(any(target_os = "windows", target_os = "linux"))]
mod signaling;
#[cfg(any(target_os = "windows", target_os = "linux"))]
mod voice;

#[cfg(any(target_os = "windows", target_os = "linux"))]
fn main() -> gpui::Result<()> {
    app::run()
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
compile_error!("Yapper GPUI targets Windows and Linux. Use the Electron client on macOS.");
