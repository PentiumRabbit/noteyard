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
});
