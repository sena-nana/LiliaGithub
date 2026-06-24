import { computed, nextTick, onMounted, onUnmounted, ref, watch, type Ref } from "vue";
import { useComponentEpoch } from "../../composables/useComponentEpoch";
import { createLatestAsyncLoader } from "../../composables/useLatestAsyncLoader";
import {
  getRepoFilePreview,
  listRepoFiles,
  openPath,
  openUrl,
} from "../../services/workspace/client";
import type { RepoChange, RepoFilePreview, RepoFileTreeEntry } from "../../services/workspace/types";
import {
  diffCodeLanguageLabel,
  inferDiffCodeLanguage,
  isDiffCodeLanguage,
  tokenizeDiffCodeLines,
} from "../../utils/diffCode";
import { changeStatusLetter, changeStatusText, changeStatusTone } from "../../utils/repoDisplay";
import type { ReadmeLinkTarget } from "../../utils/readmeLinks";

type MarkdownReadmeHandle = {
  scrollToAnchor(hash: string): void;
};

export interface RepoFileBrowserInput {
  repoId: Ref<string>;
  repoPath: Ref<string | null | undefined>;
  repoRef: Ref<string | null | undefined>;
  changes: Ref<readonly RepoChange[] | undefined>;
  targetPath: Ref<string | null | undefined>;
  targetHash: Ref<string | null | undefined>;
  enabled?: Ref<boolean | undefined>;
}

const ROOT_KEY = "";

export function useRepoFileBrowser(input: RepoFileBrowserInput) {
  const markdownReadme = ref<MarkdownReadmeHandle | null>(null);
  const directoryEntries = ref<Record<string, RepoFileTreeEntry[]>>({});
  const expandedDirectories = ref<string[]>([]);
  const directoryLoading = ref<string[]>([]);
  const treeLoading = ref(false);
  const treeError = ref<string | null>(null);
  const selectedPath = ref<string | null>(null);
  const preview = ref<RepoFilePreview | null>(null);
  const textPreviewTargetLine = ref<number | null>(null);
  const previewLoading = ref(false);
  const previewError = ref<string | null>(null);
  const componentEpoch = useComponentEpoch();
  const panelLoader = createLatestAsyncLoader({ componentEpoch, trackSessionContext: false });
  const previewLoader = createLatestAsyncLoader({ componentEpoch, trackSessionContext: false });
  let directoryLoadPromises = new Map<string, Promise<RepoFileTreeEntry[]>>();

  const repoPath = computed(() => input.repoPath.value ?? null);
  const repoLocationLabel = computed(() => repoPath.value || currentRepoRef() || "");
  const knownMarkdownPaths = computed(() =>
    Array.from(
      new Set(
        Object.values(directoryEntries.value)
          .flat()
          .filter((entry) => entry.kind === "file" && /\.(md|markdown)$/i.test(entry.name))
          .map((entry) => entry.path),
      ),
    ),
  );
  const textPreviewLanguage = computed(() =>
    preview.value?.previewKind === "text" ? inferDiffCodeLanguage(preview.value.path) : "text",
  );
  const isCodePreview = computed(() =>
    preview.value?.previewKind === "text" && isDiffCodeLanguage(textPreviewLanguage.value),
  );
  const textPreviewLines = computed(() =>
    preview.value?.previewKind === "text"
      ? tokenizeDiffCodeLines(preview.value.content ?? "", textPreviewLanguage.value)
      : [],
  );
  const fileChangeBadges = computed(() =>
    new Map(
      (input.changes.value ?? []).map((change) => [
        change.path,
        {
          className: changeStatusTone(change),
          label: changeStatusText(change),
          letter: changeStatusLetter(change),
        },
      ]),
    ),
  );
  const visibleEntries = computed(() => flattenEntries(ROOT_KEY, 0));
  const previewTitle = computed(() => {
    if (preview.value) return preview.value.path;
    if (selectedPath.value) return selectedPath.value;
    return "文件预览";
  });
  const previewDescription = computed(() => {
    if (!preview.value) return "";
    if (preview.value.previewKind === "tooLarge") return `文件过大，${formatFileSize(preview.value.size)}，无法预览`;
    if (preview.value.previewKind === "binary") return `二进制文件，${formatFileSize(preview.value.size)}，无法预览`;
    if (preview.value.previewKind === "text") {
      return isCodePreview.value
        ? `代码 · ${diffCodeLanguageLabel(textPreviewLanguage.value)} · ${formatFileSize(preview.value.size)}`
        : `文本 · ${formatFileSize(preview.value.size)}`;
    }
    if (preview.value.previewKind === "markdown") return `Markdown · ${formatFileSize(preview.value.size)}`;
    if (preview.value.previewKind === "image") return `图片 · ${formatFileSize(preview.value.size)}`;
    return `${preview.value.previewKind} · ${formatFileSize(preview.value.size)}`;
  });
  const absolutePreviewPath = computed(() => {
    if (!preview.value || !repoPath.value) return null;
    const separator = repoPath.value.includes("\\") ? "\\" : "/";
    return `${repoPath.value.replace(/[\\/]+$/, "")}${separator}${preview.value.path.replace(/\//g, separator)}`;
  });

  onMounted(() => {
    if (isEnabled()) void initializePanel();
  });

  onUnmounted(() => {
    panelLoader.invalidate();
    previewLoader.invalidate();
    directoryLoadPromises.clear();
  });

  watch(
    () => [input.repoId.value, input.repoRef.value, isEnabled()],
    ([, , enabled]) => {
      if (enabled) void initializePanel();
    },
  );

  watch(
    () => [input.targetPath.value, input.targetHash.value] as const,
    ([path, hash]) => {
      if (!path || !isEnabled()) return;
      void selectFile(path, hash);
    },
  );

  async function initializePanel() {
    const repoId = input.repoId.value;
    const repoRef = currentRepoRef();
    await panelLoader.run(`${repoId}:${repoRef ?? ""}`, async (runId) => {
      previewLoader.invalidate();
      directoryLoadPromises.clear();
      directoryEntries.value = {};
      expandedDirectories.value = [];
      directoryLoading.value = [];
      treeLoading.value = true;
      treeError.value = null;
      selectedPath.value = null;
      preview.value = null;
      textPreviewTargetLine.value = null;
      previewLoading.value = false;
      previewError.value = null;

      try {
        const rootEntries = await loadDirectory(null, { force: true, repoId, repoRef });
        if (!panelLoader.isCurrent(runId) || !isCurrentRepoRequest(repoId, repoRef)) return;
        treeLoading.value = false;
        if (input.targetPath.value) {
          await selectFile(input.targetPath.value, input.targetHash.value);
        } else {
          const defaultFile =
            rootEntries.find((entry) => entry.kind === "file" && entry.path === "README.md") ??
            rootEntries.find((entry) => entry.kind === "file");
          if (defaultFile) {
            await selectFile(defaultFile.path);
          }
        }
      } catch (err) {
        if (!panelLoader.isCurrent(runId)) return;
        treeError.value = String(err);
      } finally {
        if (panelLoader.isCurrent(runId)) {
          treeLoading.value = false;
        }
      }
    }, { reusePending: true });
  }

  function flattenEntries(
    parentPath: string,
    depth: number,
  ): Array<{ entry: RepoFileTreeEntry; depth: number; badge: ReturnType<typeof treeEntryBadge> }> {
    const entries = directoryEntries.value[parentPath] ?? [];
    const flattened: Array<{ entry: RepoFileTreeEntry; depth: number; badge: ReturnType<typeof treeEntryBadge> }> = [];
    for (const entry of entries) {
      flattened.push({ entry, depth, badge: treeEntryBadge(entry) });
      if (entry.kind === "dir" && expandedDirectories.value.includes(entry.path)) {
        flattened.push(...flattenEntries(entry.path, depth + 1));
      }
    }
    return flattened;
  }

  async function loadDirectory(
    parentPath: string | null,
    options: { force?: boolean; repoId?: string; repoRef?: string | null } = {},
  ) {
    const key = parentPath ?? ROOT_KEY;
    const repoId = options.repoId ?? input.repoId.value;
    const repoRef = options.repoRef ?? currentRepoRef();
    if (!options.force && key in directoryEntries.value) {
      return directoryEntries.value[key] ?? [];
    }
    const pending = directoryLoadPromises.get(key);
    if (!options.force && pending) {
      return pending;
    }
    directoryLoading.value = [...directoryLoading.value, key];
    let loadPromise!: Promise<RepoFileTreeEntry[]>;
    loadPromise = (async () => {
      try {
        const entries = repoRef
          ? await listRepoFiles(repoId, parentPath, repoRef)
          : await listRepoFiles(repoId, parentPath);
        if (isCurrentRepoRequest(repoId, repoRef)) {
          directoryEntries.value = {
            ...directoryEntries.value,
            [key]: entries,
          };
        }
        return entries;
      } finally {
        if (directoryLoadPromises.get(key) === loadPromise) {
          directoryLoadPromises.delete(key);
          directoryLoading.value = directoryLoading.value.filter((item) => item !== key);
        }
      }
    })();
    directoryLoadPromises.set(key, loadPromise);
    return loadPromise;
  }

  async function toggleDirectory(entry: RepoFileTreeEntry) {
    if (entry.kind !== "dir") return;
    if (expandedDirectories.value.includes(entry.path)) {
      expandedDirectories.value = expandedDirectories.value.filter((path) => path !== entry.path);
      return;
    }
    expandedDirectories.value = [...expandedDirectories.value, entry.path];
    await loadDirectory(entry.path);
  }

  async function expandAncestors(filePath: string, repoId: string) {
    const repoRef = currentRepoRef();
    const segments = filePath.split("/").slice(0, -1);
    let current = "";
    for (const segment of segments) {
      if (!isCurrentRepoRequest(repoId, repoRef)) return false;
      current = current ? `${current}/${segment}` : segment;
      if (!expandedDirectories.value.includes(current)) {
        expandedDirectories.value = [...expandedDirectories.value, current];
      }
      await loadDirectory(current, { repoId, repoRef });
    }
    return isCurrentRepoRequest(repoId, repoRef);
  }

  async function selectFile(path: string, hash?: string | null) {
    const repoId = input.repoId.value;
    const repoRef = currentRepoRef();
    selectedPath.value = path;
    await previewLoader.run(`${repoId}:${repoRef ?? ""}:${path}`, async (runId) => {
      previewLoading.value = true;
      previewError.value = null;
      try {
        const ancestorsReady = await expandAncestors(path, repoId);
        if (!ancestorsReady || !previewLoader.isCurrent(runId)) return;
        const nextPreview = repoRef
          ? await getRepoFilePreview(repoId, path, repoRef)
          : await getRepoFilePreview(repoId, path);
        if (
          !previewLoader.isCurrent(runId) ||
          !isCurrentRepoRequest(repoId, repoRef) ||
          selectedPath.value !== path
        ) return;
        preview.value = nextPreview;
        textPreviewTargetLine.value = nextPreview.previewKind === "text" ? lineHashNumber(hash) : null;
        if (hash && nextPreview.previewKind === "markdown") {
          await nextTick();
          if (previewLoader.isCurrent(runId)) {
            markdownReadme.value?.scrollToAnchor(hash);
          }
        }
      } catch (err) {
        if (!previewLoader.isCurrent(runId)) return;
        preview.value = null;
        textPreviewTargetLine.value = null;
        previewError.value = String(err);
      } finally {
        if (previewLoader.isCurrent(runId)) {
          previewLoading.value = false;
        }
      }
    });
  }

  async function openPreviewLink(target: ReadmeLinkTarget) {
    if (target.kind === "external") {
      void openUrl(target.href);
      return;
    }
    if (target.kind === "anchor") {
      await nextTick();
      markdownReadme.value?.scrollToAnchor(target.hash);
      return;
    }
    if (target.kind === "readme") {
      await selectFile(target.path, target.hash);
      return;
    }
    await selectFile(target.relativePath, target.hash);
  }

  function isDirectoryExpanded(path: string) {
    return expandedDirectories.value.includes(path);
  }

  function isDirectoryLoading(path: string) {
    return directoryLoading.value.includes(path);
  }

  function isTreeItemActive(entry: RepoFileTreeEntry) {
    return entry.kind === "file" && selectedPath.value === entry.path;
  }

  function treeEntryBadge(entry: RepoFileTreeEntry) {
    if (entry.kind !== "file") return null;
    return fileChangeBadges.value.get(entry.path) ?? null;
  }

  function currentRepoRef() {
    return input.repoRef.value ?? null;
  }

  function isEnabled() {
    return input.enabled?.value !== false;
  }

  function isCurrentRepoRequest(repoId: string, repoRef: string | null) {
    return repoId === input.repoId.value && repoRef === currentRepoRef();
  }

  function openPreviewFile() {
    if (!absolutePreviewPath.value) return;
    void openPath(absolutePreviewPath.value);
  }

  return {
    absolutePreviewPath,
    knownMarkdownPaths,
    isCodePreview,
    markdownReadme,
    preview,
    previewDescription,
    previewError,
    previewLoading,
    previewTitle,
    repoLocationLabel,
    repoPath,
    selectedPath,
    textPreviewLines,
    textPreviewTargetLine,
    treeError,
    treeLoading,
    visibleEntries,
    isDirectoryExpanded,
    isDirectoryLoading,
    isTreeItemActive,
    openPreviewFile,
    openPreviewLink,
    selectFile,
    toggleDirectory,
  };
}

export type RepoFileBrowser = ReturnType<typeof useRepoFileBrowser>;

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function lineHashNumber(hash?: string | null) {
  const match = hash?.trim().match(/^L(\d+)$/i);
  if (!match) return null;
  const line = Number.parseInt(match[1], 10);
  return Number.isFinite(line) && line > 0 ? line : null;
}
