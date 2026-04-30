import type { Block, Page } from "../types";

const BASE = "http://localhost:8080/api";

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
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
}

export const api = {
  pages: {
    listAll: () => req<Page[]>("GET", "/pages"),
    get: (id: string) => req<Page>("GET", `/pages/${id}`),
    create: (data: Partial<Page>) => req<Page>("POST", "/pages", data),
    update: (id: string, data: Partial<Page>) => req<Page>("PUT", `/pages/${id}`, data),
    delete: (id: string) => req<void>("DELETE", `/pages/${id}`),
  },
  blocks: {
    listByPage: (pageId: string) => req<Block[]>("GET", `/pages/${pageId}/blocks`),
    create: (pageId: string, data: Partial<Block>) => req<Block>("POST", `/pages/${pageId}/blocks`, data),
    update: (id: string, data: Partial<Block>) => req<Block>("PUT", `/blocks/${id}`, data),
    delete: (id: string) => req<void>("DELETE", `/blocks/${id}`),
    batchUpdate: (blocks: Partial<Block>[]) => req<void>("PATCH", "/blocks/batch", blocks),
  },
};
