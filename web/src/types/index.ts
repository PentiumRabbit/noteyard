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
  type: "text" | "number" | "checkbox" | "select" | "date" | "formula";
  options: string;
  formula: string;
  order_index: number;
  created_at: number;
  updated_at: number;
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
