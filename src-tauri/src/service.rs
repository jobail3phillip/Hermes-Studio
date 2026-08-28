use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

/// Handle to the Studio Node server we may have spawned.
static MANAGED: Mutex<Option<Child>> = Mutex::new(None);

const HOST: &str = "127.0.0.1";
const PORT: u16 = 3000;
const PROBE_TIMEOUT: Duration = Duration::from_millis(600);
const START_WAIT: Duration = Duration::from_secs(25);

/// True if something is already answering on 127.0.0.1:3000.
pub fn studio_service_running() -> bool {
    use std::net::SocketAddr;
    let addr: SocketAddr = format!("{HOST}:{PORT}").parse().unwrap();
    TcpStream::connect_timeout(&addr, PROBE_TIMEOUT).is_ok()
}

/// Locate the Hermes-Studio project directory.
fn studio_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("HERMES_STUDIO_DIR") {
        return PathBuf::from(dir);
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join("Projects").join("Hermes-Studio")
}

/// Start the Studio Node server if it is not already running, then wait until
/// the web service answers. Only marks the process as MANAGED if *we* spawned it.
pub fn ensure_studio_service(app: AppHandle) {
    if studio_service_running() {
        // Already running — attach only; do not manage.
        app.emit("studio-service", "already-running").ok();
        return;
    }

    let dir = studio_dir();
    let server = dir.join("server-entry.js");
    if !server.exists() {
        app.emit("studio-service", "error:not-found").ok();
        return;
    }

    let child = match Command::new("node")
        .arg(&server)
        .current_dir(&dir)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            app.emit("studio-service", format!("error:start:{e}")).ok();
            return;
        }
    };

    let mut guard = MANAGED.lock().unwrap();
    *guard = Some(child);
    drop(guard);

    // Wait for the service to come up (bounded).
    let start = Instant::now();
    while start.elapsed() < START_WAIT {
        if studio_service_running() {
            app.emit("studio-service", "started").ok();
            return;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    app.emit("studio-service", "start-timeout").ok();
}

/// Kill the Node server only if we are the ones who started it.
pub fn stop_if_managed() {
    let mut guard = MANAGED.lock().unwrap();
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        // Drain to avoid zombies.
        let _ = child.wait();
    }
}
