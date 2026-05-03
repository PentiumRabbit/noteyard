// databaseConstants.ts — Shared constants and utilities for DatabaseView and sub-components
import type { DBColumn } from "../../types";

export const COL_TYPES: DBColumn["type"][] = ["text", "number", "checkbox", "select", "multi-select", "date", "formula", "url", "email", "created_time", "last_edited_time", "files", "relation", "rollup", "phone", "people", "status"];

export const COL_TYPE_LABELS: Record<string, string> = {
  text: "纯文本内容",
  number: "数字、金额、计算",
  checkbox: "勾选 / 布尔值",
  select: "单选标签",
  "multi-select": "多选标签",
  date: "日期和时间",
  formula: "自动计算公式",
  url: "网页链接",
  email: "邮件地址",
  created_time: "自动记录创建时间",
  last_edited_time: "自动记录编辑时间",
  files: "文件和附件",
  relation: "关联其他数据库",
  rollup: "汇总关联列数据",
  phone: "电话",
  people: "人员",
  status: "状态",
};

export const READONLY_COL_TYPES = new Set(["formula", "created_time", "last_edited_time", "rollup"]);

export const FORMULA_FUNCTIONS = ["IF", "CONCAT", "ROUND", "ABS", "NOT"];

export function fmtTimestamp(ts: number | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
