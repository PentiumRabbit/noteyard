import toast from "react-hot-toast";
import type { Block, DBCell, DBColumn, DBRow, Database, Page, SearchResponse } from "../types";

export const API_BASE = "http://localhost:8080";
const BASE = API_BASE + "/api";

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((err as { error: string }).error || res.statusText);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  } catch (err) {
    toast.error((err as Error).message);
    throw err;
  }
}

export function exportAll(format: 'markdown' | 'json') {
  const a = document.createElement('a');
  a.href = `/api/export?format=${format}`;
  a.click();
}

export function exportPage(pageId: string, format: 'markdown' | 'json') {
  const a = document.createElement('a');
  a.href = `/api/pages/${pageId}/export?format=${format}`;
  a.click();
}

export const api = {
  databases: {
    create: (data: { id: string; page_id: string; title: string }) => req<Database>("POST", "/databases", data),
    get: (id: string) => req<Database>("GET", `/databases/${id}`),
    updateTitle: (id: string, title: string) => req<void>("PATCH", `/databases/${id}`, { title }),
    delete: (id: string) => req<void>("DELETE", `/databases/${id}`),
    addColumn: (dbId: string, col: Partial<DBColumn>) =>
      req<DBColumn>("POST", `/databases/${dbId}/columns`, col),
    updateColumn: (dbId: string, colId: string, col: Partial<DBColumn>) =>
      req<DBColumn>("PUT", `/databases/${dbId}/columns/${colId}`, col),
    deleteColumn: (dbId: string, colId: string) =>
      req<void>("DELETE", `/databases/${dbId}/columns/${colId}`),
    addRow: (dbId: string) => req<DBRow>("POST", `/databases/${dbId}/rows`, {}),
    deleteRow: (dbId: string, rowId: string) =>
      req<void>("DELETE", `/databases/${dbId}/rows/${rowId}`),
    listRows: (dbId: string, opts?: { sortCol?: string; sortOrder?: "asc" | "desc"; filterCol?: string; filterOp?: string; filterVal?: string }) => {
      const params = new URLSearchParams();
      if (opts?.sortCol) params.set("sort_col", opts.sortCol);
      if (opts?.sortOrder) params.set("sort_order", opts.sortOrder);
      if (opts?.filterCol) params.set("filter_col", opts.filterCol);
      if (opts?.filterOp) params.set("filter_op", opts.filterOp);
      if (opts?.filterVal !== undefined) params.set("filter_val", opts.filterVal);
      const qs = params.toString();
      return req<DBRow[]>("GET", `/databases/${dbId}/rows${qs ? "?" + qs : ""}`);
    },
    getRow: (dbId: string, rowId: string) =>
      req<DBRow>("GET", `/databases/${dbId}/rows/${rowId}`),
    updateCells: (dbId: string, rowId: string, cells: DBCell[]) =>
      req<void>("PATCH", `/databases/${dbId}/rows/${rowId}/cells`, cells),
    updateRowContent: (dbId: string, rowId: string, content: string): Promise<void> =>
      req<void>("PATCH", `/databases/${dbId}/rows/${rowId}`, { content }),
  },
  pages: {
    listAll: () => req<Page[]>("GET", "/pages"),
    get: (id: string) => req<Page>("GET", `/pages/${id}`),
    getAncestors: (id: string) => req<Page[]>("GET", `/pages/${id}/ancestors`),
    create: (data: Partial<Page>) => req<Page>("POST", "/pages", data),
    update: (id: string, data: Partial<Page>) => req<Page>("PUT", `/pages/${id}`, data),
    delete: (id: string) => req<void>("DELETE", `/pages/${id}`),
    listTrashed: () => req<Page[]>("GET", "/pages/trash"),
    restore: (id: string) => req<void>("POST", `/pages/${id}/restore`),
    permanentDelete: (id: string) => req<void>("DELETE", `/pages/${id}/permanent`),
    search: (q: string) => req<Page[]>("GET", `/pages/search?q=${encodeURIComponent(q)}`),
    backlinks: (id: string) => req<Page[]>("GET", `/pages/${id}/backlinks`),
  },
  globalSearch: (q: string, offset?: number) => {
    const params = new URLSearchParams({ q });
    if (offset && offset > 0) params.set("offset", String(offset));
    return req<SearchResponse>("GET", `/search?${params.toString()}`);
  },
  blocks: {
    listByPage: (pageId: string) => req<Block[]>("GET", `/pages/${pageId}/blocks`),
    create: (pageId: string, data: Partial<Block>) => req<Block>("POST", `/pages/${pageId}/blocks`, data),
    update: (id: string, data: Partial<Block>) => req<Block>("PUT", `/blocks/${id}`, data),
    delete: (id: string) => req<void>("DELETE", `/blocks/${id}`),
    batchUpdate: (blocks: Partial<Block>[]) => req<void>("PATCH", "/blocks/batch", blocks),
    // sendBeacon 用于页面卸载时可靠发送，不会被浏览器截断
    batchUpdateBeacon: (blocks: Partial<Block>[]) => {
      navigator.sendBeacon(
        BASE + "/blocks/batch",
        new Blob([JSON.stringify(blocks)], { type: "application/json" }),
      );
    },
  },
};
