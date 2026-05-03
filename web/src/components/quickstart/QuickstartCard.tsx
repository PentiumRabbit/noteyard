import { useState } from "react";
import toast from "react-hot-toast";
import { api } from "../../api/client";
import quickstartData from "../../data/quickstart.json";
import "./QuickstartCard.css";

interface SeedBlock {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  content?: string | Array<{ type: string; text: string; styles: Record<string, unknown> }>;
}

interface Props {
  onImported: (pageId: string) => void;
}

function renderContent(content: SeedBlock["content"]): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content.map((inline) => inline.text).join("");
}

function renderBlocks(blocks: SeedBlock[]) {
  const elements: React.ReactNode[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (block.type === "heading") {
      const level = (block.props?.level as number) ?? 1;
      const text = renderContent(block.content);
      if (level === 1) {
        elements.push(<h1 key={block.id}>{text}</h1>);
      } else {
        elements.push(<h2 key={block.id}>{text}</h2>);
      }
      i++;
    } else if (block.type === "bulletListItem") {
      // collect consecutive bulletListItem blocks into one <ul>
      const items: React.ReactNode[] = [];
      while (i < blocks.length && blocks[i].type === "bulletListItem") {
        const b = blocks[i];
        items.push(<li key={b.id}>{renderContent(b.content)}</li>);
        i++;
      }
      elements.push(<ul key={`ul-${i}`}>{items}</ul>);
    } else if (block.type === "paragraph") {
      elements.push(<p key={block.id}>{renderContent(block.content)}</p>);
      i++;
    } else {
      i++;
    }
  }
  return elements;
}

export function QuickstartCard({ onImported }: Props) {
  const [importing, setImporting] = useState(false);

  async function handleImport() {
    setImporting(true);
    try {
      const page = await api.pages.create({ title: "快速开始", icon: "🚀" });
      const blocks = quickstartData.blocks as SeedBlock[];
      for (let idx = 0; idx < blocks.length; idx++) {
        const b = blocks[idx];
        const contentStr =
          typeof b.content === "string"
            ? JSON.stringify([{ type: "text", text: b.content, styles: {} }])
            : b.content
            ? JSON.stringify(b.content)
            : JSON.stringify([]);
        const propsStr =
          b.props ? JSON.stringify(b.props) : "{}";
        await api.blocks.create(page.id, {
          type: b.type,
          content: contentStr,
          props: propsStr,
          order_index: idx,
        });
      }
      onImported(page.id);
    } catch {
      toast.error("导入失败，请重试");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="quickstart-card">
      <div className="quickstart-body">
        {renderBlocks(quickstartData.blocks as SeedBlock[])}
      </div>
      <div className="quickstart-footer">
        <button
          className="quickstart-import-btn"
          onClick={handleImport}
          disabled={importing}
        >
          {importing ? "导入中…" : "导入为页面"}
        </button>
      </div>
    </div>
  );
}
