import { describe, expect, it } from "vitest";
import { createKeyedAsyncResource } from "../src/composables/useKeyedAsyncResource";
import { createSessionContext } from "../src/composables/sessionContext";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("createKeyedAsyncResource", () => {
  it("rejects a late result after the resource key changes", async () => {
    const resource = createKeyedAsyncResource<string, string>({ sessionContext: createSessionContext() });
    const oldRequest = deferred<string>();
    const currentRequest = deferred<string>();

    const oldLoad = resource.load("account-a/repo-a", () => oldRequest.promise);
    const currentLoad = resource.load("account-b/repo-b", () => currentRequest.promise);
    currentRequest.resolve("current");
    await currentLoad;
    oldRequest.resolve("stale");
    await oldLoad;

    expect(resource.state.value).toMatchObject({
      key: "account-b/repo-b",
      status: "ready",
      data: "current",
      error: null,
      refreshing: false,
    });
  });

  it("keeps the previous value and atomically exposes a refresh error", async () => {
    const resource = createKeyedAsyncResource<string, string>({ sessionContext: createSessionContext() });
    await resource.load("repo", async () => "cached");
    const failure = new Error("offline");
    const refresh = resource.load("repo", async () => { throw failure; });

    expect(resource.state.value).toMatchObject({ data: "cached", refreshing: true, error: null });
    await refresh;
    expect(resource.state.value).toMatchObject({
      status: "error",
      data: "cached",
      error: failure,
      refreshing: false,
    });
  });

  it("does not invalidate a resource owned by another app context", async () => {
    const firstContext = createSessionContext();
    const secondContext = createSessionContext();
    const first = createKeyedAsyncResource<string, string>({ sessionContext: firstContext });
    const second = createKeyedAsyncResource<string, string>({ sessionContext: secondContext });
    const firstRequest = deferred<string>();
    const secondRequest = deferred<string>();

    const firstLoad = first.load("repo", () => firstRequest.promise);
    const secondLoad = second.load("repo", () => secondRequest.promise);
    firstContext.invalidate();
    firstRequest.resolve("stale");
    secondRequest.resolve("current");
    await Promise.all([firstLoad, secondLoad]);

    expect(first.state.value.data).toBeNull();
    expect(second.state.value).toMatchObject({ status: "ready", data: "current" });
  });
});
