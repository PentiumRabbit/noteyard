/** Leaf text node inside an inline content array. */
export interface BNTextContent {
  type: "text";
  text: string;
  styles?: Record<string, string | boolean>;
}

/** A link node inside an inline content array. */
export interface BNLinkContent {
  type: "link";
  href: string;
  content: BNInlineContent[];
}

/** Union of all inline content node types. */
export type BNInlineContent = BNTextContent | BNLinkContent | BNInline;

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
