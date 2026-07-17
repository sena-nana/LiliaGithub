import { describe, expect, it } from "vitest";
import {
  createDiscussionCommentFallback,
  createDiscussionFallback,
  deleteDiscussionCommentFallback,
  getDiscussionFallback,
  listDiscussionCommentRepliesFallback,
  listDiscussionCommentsFallback,
  updateDiscussionAnswerFallback,
  updateDiscussionCommentFallback,
  updateDiscussionStateFallback,
} from "../src/services/workspace/discussions/fallback";

describe("Discussion 写入闭环", () => {
  it("新增、回复、编辑、采纳、状态切换和删除共享同一份分页数据", async () => {
    const created = await createDiscussionFallback("sena-nana/LiliaGithub", {
      categoryId: "questions",
      title: `mutation-${Date.now()}`,
      body: "Question",
    });
    const comment = await createDiscussionCommentFallback({ discussionId: created.id, body: " first " });
    const reply = await createDiscussionCommentFallback({ discussionId: created.id, body: "reply", replyToId: comment.id });

    expect((await listDiscussionCommentsFallback(created.number)).items.map((item) => item.id)).toEqual([comment.id]);
    expect((await listDiscussionCommentRepliesFallback(comment.id)).items.map((item) => item.id)).toEqual([reply.id]);

    const edited = await updateDiscussionCommentFallback({ commentId: reply.id, body: " edited reply " });
    expect(edited.body).toBe("edited reply");
    await updateDiscussionAnswerFallback({ commentId: comment.id, mark: true });
    await updateDiscussionStateFallback({ discussionId: created.id, action: "close" });
    await updateDiscussionStateFallback({ discussionId: created.id, action: "lock" });
    expect(await getDiscussionFallback(created.number)).toMatchObject({ closed: true, locked: true, answerId: comment.id });

    await deleteDiscussionCommentFallback(reply.id);
    expect((await listDiscussionCommentRepliesFallback(comment.id)).items).toEqual([]);
  });
});
