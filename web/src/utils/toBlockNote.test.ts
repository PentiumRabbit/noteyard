import { describe, it, expect } from "vitest";
import { toBlockNote } from "./toBlockNote";
import type { Block } from "../types";

function makeBlock(overrides: Partial<Block> = {}): Block {
  return {
    id: "b1",
    page_id: "p1",
    parent_block_id: null,
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

  // ── REQ-052: columns 旧格式 fallback ──
  it("columns 旧格式（含 columnsData）降级为 columnList 空结构，不崩溃", () => {
    const block = makeBlock({ type: "columns", content: '{"cols":"2","columnsData":"[[],[]]"}', props: "{}" });
    const result = toBlockNote([block]);
    expect(result[0].type).toBe("columnList");
    expect(result[0].children).toHaveLength(2);
    expect(result[0]!.children![0]!.type).toBe("column");
    expect(result[0]!.children![1]!.type).toBe("column");
    expect(result[0].content).toBeUndefined();
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

  // ── REQ-052: columnList 新格式 ──
  it("columnList 块正确构建 children 树", () => {
    const blocks: Block[] = [
      makeBlock({ id: "cl1", type: "columnList", content: "{}", props: "{}", parent_block_id: null, order_index: 0 }),
      makeBlock({ id: "col1", type: "column", content: "{}", props: '{"width":1}', parent_block_id: "cl1", order_index: 0 }),
      makeBlock({ id: "col2", type: "column", content: "{}", props: '{"width":1}', parent_block_id: "cl1", order_index: 1 }),
      makeBlock({ id: "p1", type: "paragraph", content: '[{"text":"hello"}]', props: "{}", parent_block_id: "col1", order_index: 0 }),
    ];
    const result = toBlockNote(blocks);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("columnList");
    expect(result[0].children).toHaveLength(2);
    expect(result[0].children![0]!.type).toBe("column");
    expect(result[0].children![0]!.children).toHaveLength(1);
    expect(result[0].children![0]!.children![0]!.type).toBe("paragraph");
    expect(result[0].children![0]!.children![0]!.content).toEqual([{ text: "hello" }]);
    expect(result[0].children![1]!.children).toHaveLength(0);
    expect(result[0].content).toBeUndefined();
  });

  it("column props.width 从 props 字段正确解析", () => {
    const blocks: Block[] = [
      makeBlock({ id: "cl1", type: "columnList", content: "{}", props: "{}", parent_block_id: null, order_index: 0 }),
      makeBlock({ id: "col1", type: "column", content: "{}", props: '{"width":2.5}', parent_block_id: "cl1", order_index: 0 }),
    ];
    const result = toBlockNote(blocks);
    expect(result[0].children![0]!.props).toEqual({ width: 2.5 });
  });

  it("columnList 列内块按 order_index 排序", () => {
    const blocks: Block[] = [
      makeBlock({ id: "cl1", type: "columnList", content: "{}", props: "{}", parent_block_id: null, order_index: 0 }),
      makeBlock({ id: "col1", type: "column", content: "{}", props: "{}", parent_block_id: "cl1", order_index: 0 }),
      makeBlock({ id: "p2", type: "paragraph", content: '[{"text":"second"}]', props: "{}", parent_block_id: "col1", order_index: 1 }),
      makeBlock({ id: "p1", type: "paragraph", content: '[{"text":"first"}]', props: "{}", parent_block_id: "col1", order_index: 0 }),
    ];
    const result = toBlockNote(blocks);
    const colChildren = result[0].children![0]!.children;
    expect(colChildren![0]!.id).toBe("p1");
    expect(colChildren![1]!.id).toBe("p2");
  });

  it("columnList 子块不出现在顶层结果中", () => {
    const blocks: Block[] = [
      makeBlock({ id: "cl1", type: "columnList", content: "{}", props: "{}", parent_block_id: null, order_index: 0 }),
      makeBlock({ id: "col1", type: "column", content: "{}", props: "{}", parent_block_id: "cl1", order_index: 0 }),
      makeBlock({ id: "p1", type: "paragraph", content: "[]", props: "{}", parent_block_id: "col1", order_index: 0 }),
    ];
    const result = toBlockNote(blocks);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("cl1");
  });

  it("columns 旧格式无 columnsData 时保持 columns 类型", () => {
    const block = makeBlock({ type: "columns", content: '{"x":"1"}', props: "{}" });
    const result = toBlockNote([block]);
    expect(result[0].type).toBe("columns");
    expect(result[0].props).toEqual({ x: "1" });
    expect(result[0].content).toBeUndefined();
  });

  // ── props-as-content 块的 content 字段应为 undefined ──
  it("props-as-content 块不含 content 数组", () => {
    const propsBlocks = ["subpage", "fileAttach", "bookmark", "embed", "pdf", "database"];
    for (const type of propsBlocks) {
      const block = makeBlock({ type, content: '{"x":"1"}', props: "{}" });
      const result = toBlockNote([block]);
      expect(result[0].content, `type=${type}`).toBeUndefined();
    }
  });
});
