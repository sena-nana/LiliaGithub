import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import RepoIssueConversation from "../src/components/repo/RepoIssueConversation.vue";
import type { GitHubDiscussionTimelineItem } from "../src/services/workspace/types";

const api = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), remove: vi.fn(), react: vi.fn() }));
vi.mock("../src/composables/useWorkspace", () => ({
  useWorkspace: () => ({ githubBinding: ref({ login: "viewer" }) }),
}));
vi.mock("../src/services/workspace/client", () => ({
  createGitHubIssueComment: api.create,
  updateGitHubIssueComment: api.update,
  deleteGitHubIssueComment: api.remove,
  addGitHubIssueCommentReaction: api.react,
  openUrl: vi.fn(),
}));

const baseItem: GitHubDiscussionTimelineItem = {
  id: "IC_1", databaseId: 1, kind: "comment", actor: "viewer", body: "existing",
  url: null, createdAt: "2026-07-17T00:00:00Z", updatedAt: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("Issue 与 Pull Request 评论写入状态", () => {
  it("pending 时阻止重复提交，失败保留草稿，成功局部追加并清空草稿", async () => {
    api.create.mockReset();
    api.create.mockRejectedValueOnce(new Error("network unavailable"));
    const view = render(RepoIssueConversation, { props: {
      repoFullName: "acme/repo", issueNumber: 26, items: [baseItem], loading: false, error: null,
      linkBaseUrl: "https://github.com/acme/repo", emptyText: "empty",
    } });
    const editor = screen.getByPlaceholderText("发表评论") as HTMLTextAreaElement;
    await fireEvent.update(editor, "draft survives");
    await fireEvent.click(screen.getByRole("button", { name: "发表评论" }));
    expect(await screen.findByText(/network unavailable/)).toBeInTheDocument();
    expect(editor.value).toBe("draft survives");

    const pending = deferred<GitHubDiscussionTimelineItem>();
    api.create.mockReturnValueOnce(pending.promise);
    await fireEvent.update(editor, "one request");
    const submit = screen.getByRole("button", { name: "发表评论" });
    await fireEvent.click(submit);
    await fireEvent.click(submit);
    expect(api.create).toHaveBeenCalledTimes(2);
    pending.resolve({ ...baseItem, id: "IC_2", databaseId: 2, body: "one request" });
    await waitFor(() => expect(editor.value).toBe(""));
    expect(screen.getByText("one request")).toBeInTheDocument();
    expect(view.getAllByRole("button", { name: /编辑/ })).toHaveLength(2);

    api.react.mockResolvedValueOnce(undefined);
    await fireEvent.click(view.getAllByRole("button", { name: /Heart/ })[0]);
    expect(await screen.findByText("Reaction 已添加")).toBeInTheDocument();
    expect(view.getAllByRole("button", { name: /Heart 1/ })).toHaveLength(1);

    await fireEvent.click(view.getAllByRole("button", { name: "删除" })[0]);
    expect(screen.getByText("确认删除这条评论？")).toBeInTheDocument();
    expect(api.remove).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(api.remove).not.toHaveBeenCalled();
  });
});
