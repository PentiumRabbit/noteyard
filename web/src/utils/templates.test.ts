import { describe, it, expect } from "vitest";
import { TEMPLATES } from "../templates";

describe("TEMPLATES", () => {
  it("包含 4 个模板", () => {
    expect(TEMPLATES).toHaveLength(4);
  });

  it("每个模板有必要字段", () => {
    for (const t of TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.icon).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(Array.isArray(t.blocks)).toBe(true);
      expect(t.blocks.length).toBeGreaterThan(0);
    }
  });

  it("id 唯一", () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("meeting-notes 包含 heading/bulletListItem/checkListItem 块", () => {
    const t = TEMPLATES.find((x) => x.id === "meeting-notes")!;
    const types = (t.blocks as { type: string }[]).map((b) => b.type);
    expect(types).toContain("heading");
    expect(types).toContain("bulletListItem");
    expect(types).toContain("checkListItem");
  });

  it("weekly-review 包含 callout 块", () => {
    const t = TEMPLATES.find((x) => x.id === "weekly-review")!;
    const types = (t.blocks as { type: string }[]).map((b) => b.type);
    expect(types).toContain("callout");
  });

  it("reading-notes 包含 quote 块", () => {
    const t = TEMPLATES.find((x) => x.id === "reading-notes")!;
    const types = (t.blocks as { type: string }[]).map((b) => b.type);
    expect(types).toContain("quote");
  });

  it("每个块有 type 和 content 字段", () => {
    for (const t of TEMPLATES) {
      for (const b of t.blocks as { type?: unknown; content?: unknown }[]) {
        expect(typeof b.type).toBe("string");
        expect(Array.isArray(b.content)).toBe(true);
      }
    }
  });
});
