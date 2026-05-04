// lib.rs — sidecar startup/stop logic

use std::net::TcpListener;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandChild;

pub struct SidecarState(pub Mutex<Option<CommandChild>>);
pub struct PortState(pub u16);

/// Bind an ephemeral port on loopback and return the port number.
/// The listener is dropped immediately so the sidecar can bind the same port.
fn pick_free_port() -> u16 {
    let listener =
        TcpListener::bind("127.0.0.1:0").expect("failed to bind ephemeral port");
    listener.local_addr().unwrap().port()
}

#[tauri::command]
fn get_port(state: tauri::State<PortState>) -> u16 {
    state.0
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("tauri".into()),
                    }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                ])
                .level(if tauri::is_dev() {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                .build(),
        )
        .manage(SidecarState(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();
            let port = pick_free_port();
            app.manage(PortState(port));
            let log_dir_str = app
                .path()
                .app_local_data_dir()
                .map(|p| p.join("logs").to_string_lossy().into_owned())
                .unwrap_or_default();
            let mut sidecar_cmd = app
                .shell()
                .sidecar("noteyard-server")
                .expect("sidecar binary not configured");
            if !log_dir_str.is_empty() {
                sidecar_cmd = sidecar_cmd.args(["--log-dir", &log_dir_str]);
            }
            sidecar_cmd = sidecar_cmd.args(["--port", &port.to_string()]);
            match sidecar_cmd.spawn() {
                Ok((rx, child)) => {
                    *app.state::<SidecarState>().0.lock().unwrap() = Some(child);
                    // Monitor sidecar exit events; notify user if it crashes unexpectedly.
                    let monitor_handle = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        use tauri_plugin_shell::process::CommandEvent;
                        let mut rx = rx;
                        while let Some(event) = rx.recv().await {
                            if let CommandEvent::Terminated(payload) = event {
                                // code == None or non-zero means unexpected exit
                                let crashed = payload.code.map(|c| c != 0).unwrap_or(true);
                                if crashed {
                                    eprintln!(
                                        "[sidecar] noteyard-server terminated unexpectedly: {:?}",
                                        payload.code
                                    );
                                    monitor_handle
                                        .dialog()
                                        .message(
                                            "后端服务（noteyard-server）已意外退出。\n\
                                             请保存工作后重启应用。",
                                        )
                                        .title("后端服务崩溃")
                                        .blocking_show();
                                }
                                break;
                            }
                        }
                    });
                }
                Err(e) => {
                    // In dev mode the binary may not exist yet; warn but continue.
                    if tauri::is_dev() {
                        eprintln!("[dev] sidecar not found, skipping: {e}");
                    } else {
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
        .invoke_handler(tauri::generate_handler![get_port])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
