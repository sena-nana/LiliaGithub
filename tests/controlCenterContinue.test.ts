import { describe, expect, it } from "vitest";
import {
  continueContextFromRoute,
  readContinueContexts,
  recordContinueContext,
  type KeyValueStorage,
} from "../src/services/controlCenter";

describe("control center continue context", () => {
  it("captures exact file, PR, Actions job and commit routes", () => {
    expect(route("/repos/local/files?file=src%2Fmain.ts&hash=L18")).toMatchObject({
      kind: "file", objectId: "src/main.ts", route: "/repos/local/files?file=src%2Fmain.ts&hash=L18",
    });
    expect(route("/repos/github%3Aacme%2Frepo?projectTab=pulls&pr=26")).toMatchObject({
      kind: "pull_request", objectId: "26", repositoryId: "github:acme/repo",
    });
    expect(route("/repos/local?projectTab=actions&run=91&job=7")).toMatchObject({
      kind: "actions_job", objectId: "91:7",
    });
    expect(route("/repos/local/commits/abcdef123456")).toMatchObject({
      kind: "commit", objectId: "abcdef123456", title: "提交 abcdef12",
    });
  });

  it("persists only reconstructable routes, deduplicates semantic targets and restores newest first", () => {
    const storage = new MemoryStorage();
    const first = route("/repos/local?projectTab=issues&issue=1", 100)!;
    const second = route("/repos/local?projectTab=pulls&pr=2", 200)!;
    recordContinueContext(first, storage);
    recordContinueContext(second, storage);
    recordContinueContext({ ...first, route: "/repos/local?projectTab=issues&issue=1&issueQ=bug", updatedAt: 300 }, storage);
    recordContinueContext({
      ...second,
      id: "branch:local:main",
      kind: "branch",
      branch: "main",
      objectId: "main",
      updatedAt: 400,
    }, storage);

    expect(readContinueContexts(storage).items.map((item) => ({ id: item.id, route: item.route }))).toEqual([
      { id: "branch:local:main", route: second.route },
      { id: first.id, route: "/repos/local?projectTab=issues&issue=1&issueQ=bug" },
    ]);
    storage.setItem("lilia-github.control-center.continue.v1", JSON.stringify({
      version: 1,
      items: [{ ...first, route: "https://example.com" }],
    }));
    expect(readContinueContexts(storage).items).toEqual([]);
  });
});

function route(fullPath: string, now = 1_000) {
  const [path, search = ""] = fullPath.split("?");
  const query = Object.fromEntries(new URLSearchParams(search));
  return continueContextFromRoute({ path: path!, fullPath, query }, now);
}

class MemoryStorage implements KeyValueStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
