import { API_BASE } from "../api/client";
import { invoke } from "@tauri-apps/api/core";

type Level = "DEBUG" | "INFO" | "WARN" | "ERROR";

const LOCAL_LOG_KEY = "noteyard:logs";
const LOCAL_LOG_MAX = 500;

function writeLocal(level: Level, msg: string, fields?: Record<string, unknown>): void {
  try {
    const entry = { time: new Date().toISOString(), level, msg, ...(fields ? { fields } : {}) };
    const raw = localStorage.getItem(LOCAL_LOG_KEY);
    const logs: unknown[] = raw ? JSON.parse(raw) : [];
    logs.push(entry);
    if (logs.length > LOCAL_LOG_MAX) logs.splice(0, logs.length - LOCAL_LOG_MAX);
    localStorage.setItem(LOCAL_LOG_KEY, JSON.stringify(logs));
  } catch {
    // localStorage unavailable — silently ignore
  }
}

function send(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (level === "DEBUG" && !import.meta.env.DEV) return;

  const consoleFn = level === "ERROR" ? console.error : level === "WARN" ? console.warn : console.log;
  consoleFn(`[noteyard:${level}]`, msg, fields ?? "");

  writeLocal(level, msg, fields);

  const body: Record<string, unknown> = { level, layer: "frontend", msg };
  if (fields && Object.keys(fields).length > 0) body.fields = fields;

  fetch(API_BASE + "/api/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {
    // Backend unreachable — log is already in localStorage and console.
    const fallbackFn = level === "ERROR" ? console.error : console.warn;
    fallbackFn(`[noteyard:log] backend unreachable, log dropped: ${msg}`);
  });

  if (typeof window !== "undefined" && (window as any).__TAURI__) {
    invoke("write_frontend_log", {
      level,
      layer: "frontend",
      msg,
      fields: fields ?? null,
    }).catch(() => {}); // 静默失败，不影响主路径
  }
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
