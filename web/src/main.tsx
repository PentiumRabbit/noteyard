import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { initSettings } from "./settings/settingsStore";
import { setApiBase } from "./api/client";

async function bootstrap() {
  initSettings();

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const port = await invoke<number>("get_port");
    setApiBase(`http://localhost:${port}`);
  } catch {
    // Non-Tauri environment (e.g. standalone Vite dev server): keep default 8080.
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

bootstrap();
