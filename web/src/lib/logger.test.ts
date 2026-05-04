import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as logger from "./logger";

function mockFetchSuccess() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200 }),
  );
}

function mockFetchFailure() {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logger — 正常调用", () => {
  it("info() 发送 POST 到 /api/log，包含正确字段", async () => {
    mockFetchSuccess();
    logger.info("test message", { key: "val" });
    await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledOnce());

    const [url, opts] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8080/api/log");
    expect(opts.method).toBe("POST");

    const body = JSON.parse(opts.body as string);
    expect(body.level).toBe("INFO");
    expect(body.layer).toBe("frontend");
    expect(body.msg).toBe("test message");
    expect(body.fields).toEqual({ key: "val" });
  });

  it("warn() 发送 WARN 级别", async () => {
    mockFetchSuccess();
    logger.warn("warn msg");
    await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledOnce());

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body.level).toBe("WARN");
  });

  it("error() 发送 ERROR 级别", async () => {
    mockFetchSuccess();
    logger.error("error msg");
    await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledOnce());

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body.level).toBe("ERROR");
  });

  it("debug() 在开发模式下发送请求", async () => {
    mockFetchSuccess();
    logger.debug("debug msg");
    await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledOnce());

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body.level).toBe("DEBUG");
  });
});

describe("logger — fetch 失败静默降级", () => {
  it("info() fetch 失败时不抛出异常", async () => {
    mockFetchFailure();
    expect(() => logger.info("msg")).not.toThrow();
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled());
  });

  it("warn() fetch 失败时不抛出异常", async () => {
    mockFetchFailure();
    expect(() => logger.warn("msg")).not.toThrow();
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled());
  });

  it("error() fetch 失败时调用 console.error 而非 console.warn", async () => {
    mockFetchFailure();
    expect(() => logger.error("msg")).not.toThrow();
    await vi.waitFor(() => expect(console.error).toHaveBeenCalled());
  });
});

describe("logger — 生产模式 DEBUG 不发送", () => {
  it("import.meta.env.DEV = false 时 debug() 不发送请求", () => {
    vi.stubEnv("DEV", false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    logger.debug("should not send");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
