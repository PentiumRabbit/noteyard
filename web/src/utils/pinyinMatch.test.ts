import { describe, it, expect } from "vitest";
import { pinyinMatch } from "./pinyinMatch";

describe("pinyinMatch", () => {
  it("空查询匹配所有", () => {
    expect(pinyinMatch("表格", "")).toBe(true);
  });

  it("直接子串匹配", () => {
    expect(pinyinMatch("Database", "data")).toBe(true);
    expect(pinyinMatch("Divider", "div")).toBe(true);
  });

  it("全拼匹配", () => {
    expect(pinyinMatch("表格", "biaoge")).toBe(true);
    expect(pinyinMatch("数据库", "shujuku")).toBe(true);
    expect(pinyinMatch("引用", "yinyong")).toBe(true);
  });

  it("首字母缩写匹配", () => {
    expect(pinyinMatch("中文拼音", "zwpy")).toBe(true);
    expect(pinyinMatch("表格", "bg")).toBe(true);
    expect(pinyinMatch("数据库", "sjk")).toBe(true);
  });

  it("不匹配时返回 false", () => {
    expect(pinyinMatch("表格", "xyz")).toBe(false);
    expect(pinyinMatch("数据库", "biaoge")).toBe(false);
  });

  it("大小写不敏感", () => {
    expect(pinyinMatch("Database", "DATA")).toBe(true);
  });
});
