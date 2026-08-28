#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
