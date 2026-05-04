import type { DBRow, FilterState } from "../types";

/**
 * 判断单行是否匹配单条过滤规则。
 * 操作符语义与后端 sort_filter.go matchFilter 对齐：
 * - contains / not_contains：大小写不敏感
 * - equals / not_equals：大小写敏感（与后端一致）
 * - is_empty / is_not_empty：忽略 val
 * - gt / lt：数值比较，parseFloat 失败（NaN）时返回 false
 */
export function matchFilter(cellVal: string, op: string, val: string): boolean {
  switch (op) {
    case "contains":
      return cellVal.toLowerCase().includes(val.toLowerCase());
    case "not_contains":
      return !cellVal.toLowerCase().includes(val.toLowerCase());
    case "equals":
      return cellVal === val;
    case "not_equals":
      return cellVal !== val;
    case "is_empty":
      return cellVal === "";
    case "is_not_empty":
      return cellVal !== "";
    case "gt": {
      const a = parseFloat(cellVal);
      const b = parseFloat(val);
      return !isNaN(a) && !isNaN(b) && a > b;
    }
    case "lt": {
      const a = parseFloat(cellVal);
      const b = parseFloat(val);
      return !isNaN(a) && !isNaN(b) && a < b;
    }
    default:
      return false;
  }
}

/**
 * 将过滤规则集合应用到行列表，返回满足所有活跃过滤条件的行。
 * 活跃条件：colId 非空，且 op 为 is_empty/is_not_empty，或 val 非空。
 */
export function applyFilters(rows: DBRow[], filterStates: FilterState[]): DBRow[] {
  const activeFilters = filterStates.filter(
    f => f.colId && (f.op === "is_empty" || f.op === "is_not_empty" || f.val !== ""),
  );
  if (activeFilters.length === 0) return rows;
  return rows.filter(row =>
    activeFilters.every(f => matchFilter(row.cells[f.colId] ?? "", f.op, f.val)),
  );
}
