import type { DBColumn, RelationColumnOptions, RollupColumnOptions } from "../types";

export function parseRelationOpts(col: DBColumn): RelationColumnOptions | null {
  try {
    const opts = JSON.parse(col.options);
    if (opts && typeof opts === "object" && "target_database_id" in opts) {
      return opts as RelationColumnOptions;
    }
    return null;
  } catch {
    return null;
  }
}

export function parseRollupOpts(col: DBColumn): RollupColumnOptions | null {
  try {
    const opts = JSON.parse(col.options);
    if (
      opts &&
      typeof opts === "object" &&
      "relation_column_id" in opts &&
      "target_column_id" in opts &&
      "aggregation" in opts
    ) {
      return opts as RollupColumnOptions;
    }
    return null;
  } catch {
    return null;
  }
}
