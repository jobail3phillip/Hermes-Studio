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

            // Note: tauri.conf.json's window `url` already points at the live
            // Studio service (127.0.0.1:3000), so no runtime navigate is needed.

            // STUDIO-004: structural fix for the WKWebView geometry desync bug
            // (see webview_fix.rs for the full mechanism). Covers resize,
            // focus, and click events; verifies the geometry correction
            // landed instead of assuming it did, unlike the rejected one-shot
            // Focused(true) nudge this supersedes.
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                crate::webview_fix::install(&window);
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
#[cfg(target_os = "macos")]
mod webview_fix;

#[cfg(test)]
mod tests {
    #[test]
    fn smoke() {
        assert_eq!(2 + 2, 4);
    }
}
