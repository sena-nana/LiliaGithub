import { describe, expect, it, vi } from "vitest";
import { createCachedAsyncModule } from "../src/utils/asyncModule";

describe("cached async modules", () => {
  it("caches successful first loads", async () => {
    const loader = vi.fn(async () => ({ value: "ready" }));
    const module = createCachedAsyncModule(loader);

    await expect(module.load()).resolves.toEqual({ value: "ready" });
    await expect(module.load()).resolves.toEqual({ value: "ready" });

    expect(loader).toHaveBeenCalledTimes(1);
    expect(module.state.loaded).toBe(true);
    expect(module.state.loading).toBe(false);
    expect(module.state.error).toBeNull();
  });

  it("keeps failure state and retries the next load", async () => {
    const loader = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("chunk failed"))
      .mockResolvedValueOnce("loaded");
    const module = createCachedAsyncModule(loader);

    await expect(module.load()).rejects.toThrow("chunk failed");
    expect(module.state.loaded).toBe(false);
    expect(module.state.retryCount).toBe(1);
    expect(module.state.error).toContain("chunk failed");

    await expect(module.load()).resolves.toBe("loaded");
    expect(loader).toHaveBeenCalledTimes(2);
    expect(module.state.loaded).toBe(true);
    expect(module.state.error).toBeNull();
  });
});
