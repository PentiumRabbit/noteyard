export interface Page {
  id: string;
  parent_id: string | null;
  title: string;
  icon: string | null;
  cover: string | null;
  order_index: number;
  created_at: number;
  updated_at: number;
  children?: Page[];
}

export interface Block {
  id: string;
  page_id: string;
  parent_block_id: string | null;
  type: string;
  content: string;
  props: string;
  order_index: number;
  created_at: number;
  updated_at: number;
}

export interface Database {
  id: string;
  page_id: string;
  title: string;
  columns: DBColumn[];
  created_at: number;
  updated_at: number;
}

export interface DBColumn {
  id: string;
  database_id: string;
  name: string;
  type: "text" | "number" | "checkbox" | "select" | "multi-select" | "date" | "formula" | "url" | "email" | "created_time" | "last_edited_time" | "files" | "relation" | "rollup" | "phone" | "people" | "status";
  options: string;
  formula: string;
  is_hidden: boolean;
  order_index: number;
  created_at: number;
  updated_at: number;
}

export type RollupAggregation = "count" | "count_not_empty" | "sum" | "avg" | "max" | "min" | "show_original";

export interface RollupColumnOptions {
  relation_column_id: string;
  target_column_id: string;
  aggregation: RollupAggregation;
}

export interface DBRow {
  id: string;
  database_id: string;
  order_index: number;
  cells: Record<string, string>;
  created_at: number;
  updated_at: number;
}

export interface DBCell {
  column_id: string;
  value: string;
}

export interface RelationColumnOptions {
  target_database_id: string;
  display_column_id?: string;
}

export interface FileAttachment {
  url: string;
  name: string;
  size: number;
  mime: string;
}
