import toast from "react-hot-toast";
import { api } from "../api/client";
import { TEMPLATES } from "../templates";
import type { Page } from "../types";

/**
 * 根据模板创建新页面。
 * 返回新建页面的 id，失败时 toast 并 throw。
 */
export async function createFromTemplate(
  templateId: string,
  tree: Page[],
): Promise<string> {
  const tpl = TEMPLATES.find((t) => t.id === templateId);
  if (!tpl) throw new Error(`模板 "${templateId}" 不存在`);

  const maxOrder = Math.max(0, ...tree.map((p) => p.order_index));
  try {
    const page = await api.pages.create({
      title: tpl.name,
      icon: tpl.icon,
      order_index: maxOrder + 1,
    });
    if (tpl.blocks.length > 0) {
      await api.blocks.batchUpdate(
        tpl.blocks.map((b, i) => ({
          id: crypto.randomUUID(),
          page_id: page.id,
          type: (b as { type: string }).type,
          content: JSON.stringify((b as { content?: unknown }).content ?? []),
          props: JSON.stringify((b as { props?: unknown }).props ?? {}),
          order_index: i,
          parent_block_id: null,
        })),
      );
    }
    return page.id;
  } catch (err) {
    toast.error((err as Error).message || "从模板创建失败");
    throw err;
  }
}

/**
 * 复制指定页面（含 blocks）为新页面。
 * 返回新页面的 id，失败时 toast 并 throw。
 */
export async function duplicatePage(sourcePageId: string): Promise<string> {
  try {
    const [srcPage, srcBlocks] = await Promise.all([
      api.pages.get(sourcePageId),
      api.blocks.listByPage(sourcePageId),
    ]);
    const newPage = await api.pages.create({
      parent_id: srcPage.parent_id ?? undefined,
      title: `${srcPage.title || "Untitled"} 副本`,
      icon: srcPage.icon ?? undefined,
      cover: srcPage.cover ?? undefined,
      order_index: srcPage.order_index + 0.5,
    });
    if (srcBlocks.length > 0) {
      await api.blocks.batchUpdate(
        srcBlocks.map((b) => ({
          ...b,
          id: crypto.randomUUID(),
          page_id: newPage.id,
        })),
      );
    }
    return newPage.id;
  } catch (err) {
    toast.error((err as Error).message || "复制页面失败");
    throw err;
  }
}
