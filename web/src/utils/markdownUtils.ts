import type { BNInline, BNBlock } from "../types/blocknote";

export function inlinesToText(content: BNInline[] | undefined): string {
  if (!content) return "";
  return content.map(c => {
    if (c.type === "text") return c.text ?? "";
    if (c.type === "mention") return `[${c.props?.icon ?? "📄"} ${c.props?.title ?? ""}](page:${c.props?.pageId ?? ""})`;
    if (c.type === "link") return `[${inlinesToText(c.content)}](${c.props?.href ?? ""})`;
    return c.text ?? "";
  }).join("");
}

export function blocksToMarkdown(blocks: BNBlock[]): string {
  return blocks.map(b => blockToMd(b)).filter(Boolean).join("\n\n");
}

export function blockToMd(b: BNBlock): string {
  const text = inlinesToText(b.content);
  switch (b.type) {
    case "heading": {
      const lvl = parseInt(String(b.props?.level ?? "1"), 10);
      return "#".repeat(lvl) + " " + text;
    }
    case "bulletListItem": return "- " + text;
    case "numberedListItem": return "1. " + text;
    case "checkListItem": return (b.props?.checked === "true" ? "- [x] " : "- [ ] ") + text;
    case "quote": return "> " + text;
    case "horizontalRule": return "---";
    case "callout": return `> ${b.props?.icon ?? "💡"} ${text}`;
    case "toggle": return `**${text}**`;
    case "subpage": return `📄 [${b.props?.title ?? "Untitled"}](page:${b.props?.pageId ?? ""})`;
    case "bookmark": return `🔖 [${b.props?.title || b.props?.url}](${b.props?.url})`;
    case "embed": return `🌐 <${b.props?.url}>`;
    case "fileAttach": return `📎 [${b.props?.name}](${b.props?.url})`;
    case "button": {
      const btnLabel = b.props?.label || "点击";
      const btnUrl   = b.props?.url;
      return btnUrl ? `[${btnLabel}](${btnUrl})` : `[${btnLabel}]`;
    }
    case "image": return `![image](${b.props?.url ?? ""})`;
    case "paragraph": return text;
    case "codeBlock": return "```\n" + text + "\n```";
    default: return text;
  }
}
