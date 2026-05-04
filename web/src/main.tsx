import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { initSettings } from "./settings/settingsStore";
import { setApiBase } from "./api/client";

async function resolvePort(): Promise<number | null> {
  // Retry up to 10 times with 100ms interval — Tauri IPC bridge may not be
  // ready immediately when the WebView first executes JS.
  for (let i = 0; i < 10; i++) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<number>("get_port");
    } catch (err) {
      if (i === 9) console.warn("[bootstrap] get_port failed after retries:", err);
      await new Promise(r => setTimeout(r, 100));
    }
  }
  return null;
}

async function bootstrap() {
  initSettings();

  const port = await resolvePort();
  if (port) {
    setApiBase(`http://localhost:${port}`);
  } else {
    // Non-Tauri environment (Vite dev server) or IPC unavailable — keep default 8080.
    console.info("[bootstrap] running outside Tauri or get_port unavailable, using default port 8080");
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

bootstrap();
