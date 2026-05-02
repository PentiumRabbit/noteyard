import type { FileAttachment } from "../types";

export function parseFileAttachments(raw: string): FileAttachment[] {
  if (!raw || raw === "[]") return [];
  try {
    return JSON.parse(raw) as FileAttachment[];
  } catch {
    console.warn("parseFileAttachments: invalid JSON in cell", raw);
    return [];
  }
}
