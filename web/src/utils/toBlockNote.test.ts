import { describe, it, expect } from "vitest";
import { toBlockNote } from "./toBlockNote";
import type { Block } from "../types";

function makeBlock(overrides: Partial<Block> = {}): Block {
  return {
    id: "b1",
    page_id: "p1",
    type: "paragraph",
    content: "[]",
    props: "{}",
    order_index: 0,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

describe("toBlockNote", () => {
  it("空数组返回空数组", () => {
    expect(toBlockNote([])).toEqual([]);
  });

  it("paragraph 块正确转换", () => {
    const block = makeBlock({ content: '[{"text":"hello"}]', props: '{"textAlignment":"left"}' });
    const result = toBlockNote([block]);
    expect(result[0].type).toBe("paragraph");
    expect(result[0].content).toEqual([{ text: "hello" }]);
    expect(result[0].props).toEqual({ textAlignment: "left" });
    expect(result[0].children).toEqual([]);
  });

  it("database 块 content 解析为 props", () => {
    const block = makeBlock({ type: "database", content: '{"databaseId":"db-1"}', props: "{}" });
    const result = toBlockNote([block]);
    expect(result[0].type).toBe("database");
    expect(result[0].props).toEqual({ databaseId: "db-1" });
    expect(result[0].content).toBeUndefined();
  });

  it("columns 块 content 解析为 props", () => {
    const block = makeBlock({ type: "columns", content: '{"cols":"2","columnsData":"[[],[]]"}', props: "{}" });
    const result = toBlockNote([block]);
    expect(result[0].type).toBe("columns");
    expect(result[0].props).toEqual({ cols: "2", columnsData: "[[],[]]" });
  });

  it("props 为 null 字符串时视为空对象", () => {
    const block = makeBlock({ props: "null" });
    const result = toBlockNote([block]);
    expect(result[0].props).toEqual({});
  });

  it("props 为空字符串时视为空对象", () => {
    const block = makeBlock({ props: "" });
    const result = toBlockNote([block]);
    expect(result[0].props).toEqual({});
  });

  it("props JSON 无效时视为空对象", () => {
    const block = makeBlock({ props: "not-json" });
    const result = toBlockNote([block]);
    expect(result[0].props).toEqual({});
  });

  it("content JSON 无效时视为空数组", () => {
    const block = makeBlock({ content: "bad-json" });
    const result = toBlockNote([block]);
    expect(result[0].content).toEqual([]);
  });

  it("多块按顺序保留", () => {
    const blocks = [
      makeBlock({ id: "b1", type: "paragraph", content: '["a"]' }),
      makeBlock({ id: "b2", type: "heading", content: '["b"]' }),
    ];
    const result = toBlockNote(blocks);
    expect(result[0].id).toBe("b1");
    expect(result[1].id).toBe("b2");
  });

  // ── REQ-049: subpage 块 ──
  it("subpage 块 content 解析为 props", () => {
    const block = makeBlock({ type: "subpage", content: '{"pageId":"p-99","title":"子页","icon":"📄"}', props: "{}" });
    const result = toBlockNote([block]);
    expect(result[0].type).toBe("subpage");
    expect(result[0].props).toEqual({ pageId: "p-99", title: "子页", icon: "📄" });
    expect(result[0].content).toBeUndefined();
  });

  // ── REQ-049: fileAttach 块 ──
  it("fileAttach 块 content 解析为 props", () => {
    const block = makeBlock({ type: "fileAttach", content: '{"url":"/uploads/f.pdf","name":"f.pdf","size":"123"}', props: "{}" });
    const result = toBlockNote([block]);
    expect(result[0].type).toBe("fileAttach");
    expect(result[0].props).toEqual({ url: "/uploads/f.pdf", name: "f.pdf", size: "123" });
  });

  // ── REQ-050: bookmark 块 ──
  it("bookmark 块 content 解析为 props", () => {
    const block = makeBlock({
      type: "bookmark",
      content: '{"url":"https://example.com","title":"Example","description":"Desc","favicon":"https://example.com/favicon.ico"}',
      props: "{}",
    });
    const result = toBlockNote([block]);
    expect(result[0].type).toBe("bookmark");
    expect(result[0].props).toMatchObject({ url: "https://example.com", title: "Example" });
  });

  // ── REQ-050: embed 块 ──
  it("embed 块 content 解析为 props", () => {
    const block = makeBlock({ type: "embed", content: '{"url":"https://example.com","height":"400"}', props: "{}" });
    const result = toBlockNote([block]);
    expect(result[0].type).toBe("embed");
    expect(result[0].props).toEqual({ url: "https://example.com", height: "400" });
  });

  // ── REQ-051: pdf 块 ──
  it("pdf 块 content 解析为 props", () => {
    const block = makeBlock({ type: "pdf", content: '{"url":"/uploads/doc.pdf","name":"doc.pdf","height":"600"}', props: "{}" });
    const result = toBlockNote([block]);
    expect(result[0].type).toBe("pdf");
    expect(result[0].props).toEqual({ url: "/uploads/doc.pdf", name: "doc.pdf", height: "600" });
  });

  // ── props-as-content 块的 content 字段应为 undefined ──
  it("props-as-content 块不含 content 数组", () => {
    const propsBlocks = ["subpage", "fileAttach", "bookmark", "embed", "pdf", "database", "columns"];
    for (const type of propsBlocks) {
      const block = makeBlock({ type, content: '{"x":"1"}', props: "{}" });
      const result = toBlockNote([block]);
      expect(result[0].content, `type=${type}`).toBeUndefined();
    }
  });
});
