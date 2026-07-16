import { computed, reactive, ref } from "vue";
import { createPendingTaskTracker } from "../../../composables/usePendingTaskTracker";
import { createGitHubRepositoryDiscussion } from "../../../services/workspace/discussions/client";
import type {
  GitHubRepositoryDiscussion,
  GitHubRepositoryDiscussionMetadata,
} from "../../../services/workspace/discussions/types";

export function useDiscussionCreate(
  repoFullName: string,
  metadata: { value: GitHubRepositoryDiscussionMetadata | null },
) {
  const draft = reactive({ categoryId: "", title: "", body: "" });
  const error = ref<string | null>(null);
  const tracker = createPendingTaskTracker();
  const creating = tracker.running;
  const canCreate = computed(() => metadata.value?.creatableCategories.length ? true : false);
  const canSubmit = computed(() => canCreate.value && !creating.value && Boolean(
    draft.categoryId && draft.title.trim() && draft.body.trim(),
  ));

  function prepare() {
    if (!draft.categoryId) draft.categoryId = metadata.value?.creatableCategories[0]?.id ?? "";
    error.value = null;
  }

  async function submit(): Promise<GitHubRepositoryDiscussion | null> {
    if (!canSubmit.value) return null;
    const request = {
      categoryId: draft.categoryId,
      title: draft.title.trim(),
      body: draft.body,
    };
    error.value = null;
    try {
      const created = await tracker.run(() => createGitHubRepositoryDiscussion(repoFullName, request));
      reset();
      return created;
    } catch (nextError) {
      error.value = String(nextError).replace(/^Error:\s*/, "");
      return null;
    }
  }

  function reset() {
    draft.categoryId = metadata.value?.creatableCategories[0]?.id ?? "";
    draft.title = "";
    draft.body = "";
    error.value = null;
  }

  function dispose() {
    tracker.reset();
    reset();
  }

  return { draft, error, creating, canCreate, canSubmit, prepare, submit, reset, dispose };
}
