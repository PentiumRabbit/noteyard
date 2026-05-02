// lib.rs — sidecar startup/stop logic

use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandChild;

pub struct SidecarState(pub Mutex<Option<CommandChild>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(SidecarState(Mutex::new(None)))
        .setup(|app| {
            // In dev mode the Go server is provided by `make dev`; skip sidecar.
            if !tauri::is_dev() {
                let handle = app.handle().clone();
                match app
                    .shell()
                    .sidecar("noteyard-server")
                    .expect("sidecar binary not configured")
                    .spawn()
                {
                    Ok((_rx, child)) => {
                        *app.state::<SidecarState>().0.lock().unwrap() = Some(child);
                    }
                    Err(e) => {
                        handle
                            .dialog()
                            .message(format!(
                                "无法启动后端服务（noteyard-server）：{}\n\n\
                                 可能原因：端口冲突或可执行文件缺失。\n\
                                 请检查后重新启动应用。",
                                e
                            ))
                            .title("启动失败")
                            .blocking_show();
                        std::process::exit(1);
                    }
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let handle = window.app_handle().clone();
                let child = handle
                    .state::<SidecarState>()
                    .0
                    .lock()
                    .unwrap()
                    .take();
                if let Some(child) = child {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
