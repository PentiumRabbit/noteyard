import { API_BASE } from "../api/client";

type Level = "DEBUG" | "INFO" | "WARN" | "ERROR";

function send(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (level === "DEBUG" && !import.meta.env.DEV) return;

  const body: Record<string, unknown> = { level, layer: "frontend", msg };
  if (fields && Object.keys(fields).length > 0) body.fields = fields;

  fetch(API_BASE + "/api/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch((err) => {
    if (level === "ERROR") {
      console.error("[logger] fetch failed:", err);
    } else {
      console.warn("[logger] fetch failed:", err);
    }
  });
}

export function debug(msg: string, fields?: Record<string, unknown>): void {
  send("DEBUG", msg, fields);
}

export function info(msg: string, fields?: Record<string, unknown>): void {
  send("INFO", msg, fields);
}

export function warn(msg: string, fields?: Record<string, unknown>): void {
  send("WARN", msg, fields);
}

export function error(msg: string, fields?: Record<string, unknown>): void {
  send("ERROR", msg, fields);
}
