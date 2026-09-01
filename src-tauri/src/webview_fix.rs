//! Structural fix for the WKWebView geometry desync bug (STUDIO-004).
//!
//! Root cause (converged diagnosis, tauri-apps/tauri#6927, #13898, #14843):
//! wry substitutes the window's NSView with its own WKWebView hierarchy, and
//! tao's resize plumbing does not reliably keep that substituted view's AppKit
//! frame in sync with the window's content view across every event type that
//! can invalidate it (resize, focus change, first-responder change on click).
//! autoresizingMask is set correctly by wry -- that was ruled out already.
//!
//! Rejected prior attempt: a one-shot `Focused(true)` resize nudge. It only
//! ever ran once and never checked whether the nudge actually landed, so it
//! "fixed" first paint but did nothing for a later desync triggered by a
//! click.
//!
//! This fix instead:
//! 1. Reacts to every relevant trigger (window resize, window focus, and
//!    mouse-down clicks, which is what drives first-responder changes) --
//!    not a single one-shot event.
//! 2. On each trigger, reads the *real* AppKit geometry (content view bounds
//!    vs. the webview's actual superview frame) instead of trusting that a
//!    resize call succeeded, and only forces a frame correction when they
//!    actually disagree.
//! 3. Reads the geometry back again after correcting it and logs a warning
//!    if it still disagrees, instead of assuming success.

use objc2::rc::Retained;
use objc2::Message as _;
use objc2_app_kit::{NSEvent, NSEventMask, NSView};
use tauri::{WebviewWindow, Wry};

/// Wires up geometry resync on every event known to be able to desync the
/// WKWebView frame: window resize, window focus, and mouse clicks (which
/// drive AppKit first-responder changes even when the window itself doesn't
/// move or resize).
pub fn install(window: &WebviewWindow<Wry>) {
    let w = window.clone();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Focused(true) => resync(&w),
        _ => {}
    });

    // Tauri's WindowEvent has no first-responder/click event, so hook AppKit
    // directly: a local NSEvent monitor on mouse-down events. The resync is
    // deferred one runloop tick via `run_on_main_thread` because the
    // first-responder change AppKit performs because of the click happens
    // after this monitor's handler returns.
    let w2 = window.clone();
    install_click_monitor(move || {
        let w3 = w2.clone();
        let _ = w2.run_on_main_thread(move || resync(&w3));
    });
}

/// Registers a local NSEvent monitor for mouse-down events and calls `on_click`
/// each time one fires. Intentionally leaked for the app's lifetime -- there is
/// exactly one of these per process and it must outlive every window.
fn install_click_monitor(on_click: impl Fn() + 'static) {
    use block2::RcBlock;

    let mask = NSEventMask::LeftMouseDown | NSEventMask::RightMouseDown | NSEventMask::OtherMouseDown;
    let block = RcBlock::new(move |event: std::ptr::NonNull<NSEvent>| -> *mut NSEvent {
        on_click();
        event.as_ptr()
    });
    // Safety: the block outlives the monitor (leaked below) and its captured
    // state has no thread-affinity requirements beyond running on the main
    // thread, which is where AppKit delivers these events.
    let monitor = unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &block) };
    // Leak both: the monitor must stay alive for the process lifetime, and
    // the block must outlive the monitor that references it.
    std::mem::forget(block);
    std::mem::forget(monitor);
}

/// Reads the real AppKit geometry for `window`'s webview and, only if it
/// actually disagrees with the content view it's supposed to fill, forces it
/// back into sync -- then reads it back again to verify the correction landed.
fn resync(window: &WebviewWindow<Wry>) {
    let label = window.label().to_string();
    let _ = window.with_webview(move |platform_webview| {
        // Safety: matches Tauri's own documented pattern for `with_webview`
        // on macOS (cast the opaque pointers back to their real ObjC types).
        let webview: &NSView = unsafe { &*(platform_webview.inner() as *mut NSView) };
        let ns_window: &objc2_app_kit::NSWindow =
            unsafe { &*(platform_webview.ns_window() as *mut objc2_app_kit::NSWindow) };

        let Some(content) = ns_window.contentView() else {
            return;
        };

        // Walk up from the WKWebView to the direct child of the content view
        // (wry sometimes wraps it in an internal parent view for traffic
        // lights). That direct child is the node whose frame must track the
        // content view's bounds.
        let mut managed: Retained<NSView> = webview.retain();
        loop {
            let Some(parent) = (unsafe { managed.superview() }) else {
                return; // detached from the window; nothing to fix
            };
            if Retained::as_ptr(&parent) == Retained::as_ptr(&content) {
                break;
            }
            managed = parent;
        }

        let target = content.bounds();
        let before = managed.frame();
        if frames_match(before, target) {
            return; // already in sync, nothing to force
        }

        managed.setFrame(target);
        managed.setNeedsLayout(true);
        managed.layoutSubtreeIfNeeded();
        content.displayIfNeeded();

        let after = managed.frame();
        if frames_match(after, target) {
            log::info!("webview_fix: resynced '{label}' geometry ({before:?} -> {after:?})");
        } else {
            // Structural correction didn't land -- log loudly so it shows up
            // in acceptance testing instead of silently failing like the
            // rejected one-shot nudge did.
            log::warn!(
                "webview_fix: geometry correction for '{label}' did not verify: wanted {target:?}, got {after:?}"
            );
        }
    });
}

fn frames_match(a: objc2_core_foundation::CGRect, b: objc2_core_foundation::CGRect) -> bool {
    // ponytail: exact-equality would false-positive on float noise from
    // AppKit's layout pass; 0.5pt tolerance is plenty at any real scale factor.
    const EPS: f64 = 0.5;
    (a.origin.x - b.origin.x).abs() < EPS
        && (a.origin.y - b.origin.y).abs() < EPS
        && (a.size.width - b.size.width).abs() < EPS
        && (a.size.height - b.size.height).abs() < EPS
}
