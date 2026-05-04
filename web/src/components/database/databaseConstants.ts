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

export interface FormulaFunctionDoc {
  name: string;
  signature: string;
  desc: string;
  example: string;
}

export const FORMULA_FUNCTION_DOCS: FormulaFunctionDoc[] = [
  { name: "IF",     signature: "IF(条件, 真值, 假值)",          desc: "条件成立时返回真值，否则返回假值",     example: 'IF(prop("数量") > 10, "多", "少")' },
  { name: "CONCAT", signature: "CONCAT(值1, 值2, ...)",         desc: "将多个值拼接成字符串",                 example: 'CONCAT(prop("姓"), prop("名"))' },
  { name: "ROUND",  signature: "ROUND(数字, 小数位)",            desc: "将数字四舍五入到指定小数位",           example: 'ROUND(prop("价格"), 2)' },
  { name: "ABS",    signature: "ABS(数字)",                      desc: "返回数字的绝对值",                     example: 'ABS(prop("差额"))' },
  { name: "NOT",    signature: "NOT(布尔值)",                    desc: "对布尔值取反",                        example: 'NOT(prop("已完成"))' },
];

export function fmtTimestamp(ts: number | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
