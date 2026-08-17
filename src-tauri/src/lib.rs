#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::Manager as _;
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Start the local Hermes Studio service if it is not already running,
            // so the app works without requiring JP to open a terminal.
            crate::service::ensure_studio_service(app.handle().clone());

            // Attach the window to the live local Studio service (which holds the
            // Hermes gateway bearer-token proxy) rather than the bundled static
            // client. The bundled dist is only a build-time fallback.
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(1200));
                    if let Some(win) = handle.get_webview_window("main") {
                        let _ = win.navigate("http://127.0.0.1:3000".parse().unwrap());
                    }
                });
            }

            Ok(())
        })
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Stop the sidecar only if we spawned it (managed by STARTED here).
                crate::service::stop_if_managed();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

mod service;

#[cfg(test)]
mod tests {
    #[test]
    fn smoke() {
        assert_eq!(2 + 2, 4);
    }
}
