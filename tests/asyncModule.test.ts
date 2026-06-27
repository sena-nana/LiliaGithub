import { describe, expect, it, vi } from "vitest";
import { createCachedAsyncComponent } from "../src/utils/asyncComponent";
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

  it("exposes cached component preloads with retry state", async () => {
    const firstComponent = { name: "AsyncPanel" };
    const secondComponent = { name: "AsyncPanelRetry" };
    const loader = vi
      .fn<() => Promise<{ default: typeof firstComponent }>>()
      .mockResolvedValueOnce({ default: firstComponent });
    const module = createCachedAsyncComponent(loader);

    await expect(Promise.all([module.load(), module.load()])).resolves.toEqual([
      { default: firstComponent },
      { default: firstComponent },
    ]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(module.state.loaded).toBe(true);
    expect(module.state.error).toBeNull();

    const failingLoader = vi
      .fn<() => Promise<{ default: typeof secondComponent }>>()
      .mockRejectedValueOnce(new Error("component chunk failed"))
      .mockResolvedValueOnce({ default: secondComponent });
    const failingModule = createCachedAsyncComponent(failingLoader);

    await expect(failingModule.load()).rejects.toThrow("component chunk failed");
    expect(failingModule.state.loaded).toBe(false);
    expect(failingModule.state.retryCount).toBe(1);
    expect(failingModule.state.error).toContain("component chunk failed");

    await expect(failingModule.load()).resolves.toEqual({ default: secondComponent });
    expect(failingLoader).toHaveBeenCalledTimes(2);
    expect(failingModule.state.loaded).toBe(true);
    expect(failingModule.state.error).toBeNull();
  });
});
