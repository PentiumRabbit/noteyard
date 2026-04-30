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
