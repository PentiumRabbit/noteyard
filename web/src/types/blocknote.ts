export interface BNInline {
  type: string;
  text?: string;
  content?: BNInline[];
  props?: Record<string, string>;
}

export interface BNBlock {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content?: BNInline[] | undefined;
  children?: BNBlock[];
}
