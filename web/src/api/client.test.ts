import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "./client";

function mockFetch(status: number, body: unknown) {
  const res = {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    statusText: String(status),
  };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("api.pages", () => {
  it("listAll — 成功返回页面数组", async () => {
    mockFetch(200, [{ id: "1", title: "A" }]);
    const pages = await api.pages.listAll();
    expect(pages).toHaveLength(1);
    expect(pages[0].title).toBe("A");
  });

  it("get — 成功返回单页面", async () => {
    mockFetch(200, { id: "abc", title: "Hello" });
    const page = await api.pages.get("abc");
    expect(page.id).toBe("abc");
  });

  it("create — POST body 正确", async () => {
    mockFetch(201, { id: "new", title: "New Page" });
    const page = await api.pages.create({ title: "New Page" });
    const fetchCall = vi.mocked(fetch).mock.calls[0];
    expect(fetchCall[1]?.method).toBe("POST");
    expect(fetchCall[1]?.body).toContain("New Page");
    expect(page.id).toBe("new");
  });

  it("delete — 204 返回 undefined", async () => {
    mockFetch(204, undefined);
    const result = await api.pages.delete("x");
    expect(result).toBeUndefined();
  });

  it("get — 4xx 时抛出错误", async () => {
    const res = {
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: "page not found" }),
      statusText: "Not Found",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));
    await expect(api.pages.get("missing")).rejects.toThrow("page not found");
  });

  it("listTrashed — 成功返回废纸篓页面", async () => {
    mockFetch(200, [{ id: "t1", title: "Trashed" }]);
    const pages = await api.pages.listTrashed();
    expect(pages[0].id).toBe("t1");
  });

  it("search — URL 包含查询参数", async () => {
    mockFetch(200, []);
    await api.pages.search("hello world");
    const url = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(url).toContain("q=hello%20world");
  });

  it("backlinks — 返回引用页面列表", async () => {
    mockFetch(200, [{ id: "ref", title: "Referrer" }]);
    const pages = await api.pages.backlinks("target-id");
    expect(pages[0].id).toBe("ref");
  });
});

describe("api.blocks", () => {
  it("batchUpdate — PATCH 正确发送", async () => {
    mockFetch(204, undefined);
    await api.blocks.batchUpdate([{ id: "b1", type: "paragraph" }]);
    const fetchCall = vi.mocked(fetch).mock.calls[0];
    expect(fetchCall[1]?.method).toBe("PATCH");
  });
});
