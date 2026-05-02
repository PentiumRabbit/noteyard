/**
 * Canonical block type string constants.
 * These values must match what is stored in the database; do not rename them.
 */
export const BLOCK_TYPES = {
  DATABASE: "database",
  SUBPAGE: "subpage",
  FILE_ATTACH: "fileAttach",
  BOOKMARK: "bookmark",
  EMBED: "embed",
  PDF: "pdf",
  BUTTON: "button",
  COLUMN_LIST: "columnList",
  COLUMN: "column",
  COLUMNS: "columns",
  PARAGRAPH: "paragraph",
  HEADING: "heading",
  BULLET_LIST_ITEM: "bulletListItem",
  NUMBERED_LIST_ITEM: "numberedListItem",
  CHECK_LIST_ITEM: "checkListItem",
  CODE_BLOCK: "codeBlock",
  QUOTE: "quote",
  HORIZONTAL_RULE: "horizontalRule",
  CALLOUT: "callout",
  TOGGLE: "toggle",
  IMAGE: "image",
} as const;

export type BlockType = (typeof BLOCK_TYPES)[keyof typeof BLOCK_TYPES];
