<script setup lang="ts">
import { ExternalLink } from "@lucide/vue";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { readmeHeadingId, resolveReadmeLink, type ReadmeLinkTarget } from "../../utils/readmeLinks";

const props = defineProps<{
  content: string;
  images?: Record<string, string>;
  repoRootPath?: string | null;
  currentReadmePath?: string | null;
  readmePaths?: readonly string[];
}>();

const emit = defineEmits<{
  openLink: [target: ReadmeLinkTarget];
}>();

const renderedHtml = computed(() => sanitizeHtml(renderMarkdown(props.content)));
const articleEl = ref<HTMLElement | null>(null);
const toolbarEl = ref<HTMLElement | null>(null);
const linkToolbar = ref<{ href: string; x: number; y: number } | null>(null);
const toolbarHref = computed(() => linkToolbar.value?.href ?? "");
const toolbarTarget = computed(() => resolveReadmeLink({
  href: toolbarHref.value,
  repoRootPath: props.repoRootPath,
  currentReadmePath: props.currentReadmePath,
  readmePaths: props.readmePaths,
}));
const toolbarCanOpen = computed(() => Boolean(toolbarTarget.value));

const allowedTags = new Set([
  "a",
  "blockquote",
  "b",
  "br",
  "code",
  "del",
  "details",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "input",
  "kbd",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
]);
const removableTags = new Set(["iframe", "object", "script", "style", "svg"]);
const globalAttributes = new Set(["align", "aria-label", "title"]);
const allowedAttributes: Record<string, Set<string>> = {
  a: new Set(["href"]),
  h1: new Set(["id"]),
  h2: new Set(["id"]),
  h3: new Set(["id"]),
  h4: new Set(["id"]),
  h5: new Set(["id"]),
  h6: new Set(["id"]),
  img: new Set(["alt", "height", "src", "width"]),
  input: new Set(["checked", "disabled", "type"]),
};

function renderMarkdown(content: string): string {
  const lines = stripHtmlComments(content).replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let codeLines: string[] | null = null;
  let htmlLines: string[] | null = null;
  let htmlEndTag: RegExp | null = null;
  let quoteLines: string[] | null = null;
  const headingIds = new Set<string>();

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const tag = list.ordered ? "ol" : "ul";
    blocks.push(`<${tag}>${list.items.map((item) => `<li>${renderListItem(item)}</li>`).join("")}</${tag}>`);
    list = null;
  };
  const flushQuote = () => {
    if (!quoteLines) return;
    const trimmedLines = trimEmptyLines(quoteLines);
    if (trimmedLines.length) {
      blocks.push(`<blockquote>${renderMarkdown(trimmedLines.join("\n"))}</blockquote>`);
    }
    quoteLines = null;
  };

  for (const line of lines) {
    if (htmlLines) {
      htmlLines.push(line);
      if (!htmlEndTag || htmlEndTag.test(line)) {
        blocks.push(htmlLines.join("\n"));
        htmlLines = null;
        htmlEndTag = null;
      }
      continue;
    }

    if (codeLines) {
      if (/^```/.test(line.trim())) {
        blocks.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = null;
      } else {
        codeLines.push(line);
      }
      continue;
    }

    if (/^```/.test(line.trim())) {
      flushParagraph();
      flushList();
      flushQuote();
      codeLines = [];
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      flushList();
      quoteLines ??= [];
      quoteLines.push(quote[1]);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      flushQuote();
      continue;
    }

    const htmlBlock = getHtmlBlock(line);
    if (htmlBlock) {
      flushParagraph();
      flushList();
      flushQuote();
      if (htmlBlock.endTag && !htmlBlock.endTag.test(line)) {
        htmlLines = [line];
        htmlEndTag = htmlBlock.endTag;
      } else {
        blocks.push(line);
      }
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      flushParagraph();
      flushList();
      flushQuote();
      blocks.push("<hr>");
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      flushQuote();
      const level = heading[1].length;
      const id = readmeHeadingId(plainText(heading[2]), headingIds);
      blocks.push(`<h${level} id="${escapeAttribute(id)}">${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    const listItem = /^(\s*)([-*+]|\d+\.)\s+(.+)$/.exec(line);
    if (listItem) {
      flushParagraph();
      flushQuote();
      const ordered = /\d+\./.test(listItem[2]);
      if (!list || list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push(listItem[3]);
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(line.trim());
  }

  if (codeLines) blocks.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  flushParagraph();
  flushList();
  flushQuote();
  return blocks.join("");
}

function renderInline(text: string): string {
  const pattern = /(`[^`]+`)|(\*\*([^*]+)\*\*)|(!\[([^\]]*)\]\(([^)]+)\))|(\[([^\]]+)\]\(([^)]+)\))|(<\/?[A-Za-z][^>]*>)/g;
  let html = "";
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > cursor) html += escapeHtml(text.slice(cursor, match.index));
    if (match[1]) {
      html += `<code>${escapeHtml(match[1].slice(1, -1))}</code>`;
    } else if (match[2]) {
      html += `<strong>${renderInline(match[3])}</strong>`;
    } else if (match[4]) {
      html += `<img src="${escapeAttribute(match[6])}" alt="${escapeAttribute(match[5])}">`;
    } else if (match[7]) {
      html += `<a href="${escapeAttribute(match[9])}">${renderInline(match[8])}</a>`;
    } else {
      html += match[10];
    }
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) html += escapeHtml(text.slice(cursor));
  return html;
}

function trimEmptyLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  return lines.slice(start, end);
}

function stripHtmlComments(content: string): string {
  return content.replace(/<!--[\s\S]*?-->/g, "");
}

function renderListItem(text: string): string {
  const task = /^\[([ xX])\]\s+(.+)$/.exec(text);
  if (!task) return renderInline(text);

  const checked = task[1].toLowerCase() === "x" ? " checked" : "";
  return `<input type="checkbox" disabled${checked}> ${renderInline(task[2])}`;
}

function getHtmlBlock(line: string): { endTag: RegExp | null } | null {
  const match = /^<\/?([A-Za-z][\w-]*)(?:\s[^>]*)?>\s*$/.exec(line.trim());
  if (!match) return null;

  const tagName = match[1].toLowerCase();
  if (!allowedTags.has(tagName) && !removableTags.has(tagName)) return null;
  if (/^<\//.test(line.trim()) || /\/>\s*$/.test(line.trim()) || tagName === "hr" || tagName === "br" || tagName === "img") {
    return { endTag: null };
  }
  return { endTag: new RegExp(`</${tagName}>\\s*$`, "i") };
}

function sanitizeHtml(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  sanitizeChildren(template.content);
  return template.innerHTML;
}

function sanitizeChildren(parent: ParentNode) {
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const element = node as HTMLElement;
    const tagName = element.tagName.toLowerCase();

    if (removableTags.has(tagName)) {
      element.remove();
      continue;
    }

    if (!allowedTags.has(tagName)) {
      sanitizeChildren(element);
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }

    sanitizeAttributes(element, tagName);
    sanitizeChildren(element);
  }
}

function sanitizeAttributes(element: HTMLElement, tagName: string) {
  const tagAllowedAttributes = allowedAttributes[tagName] ?? new Set<string>();

  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    if (name.startsWith("on") || (!globalAttributes.has(name) && !tagAllowedAttributes.has(name))) {
      element.removeAttribute(attribute.name);
      continue;
    }

    if (name === "href" && !isSafeUrl(attribute.value, ["http:", "https:", "mailto:"])) {
      element.removeAttribute(attribute.name);
      continue;
    }

    if (name === "id" && !/^[-_A-Za-z0-9\u00A0-\uFFFF]+$/.test(attribute.value)) {
      element.removeAttribute(attribute.name);
      continue;
    }

    if (name === "src" && !isSafeUrl(attribute.value, ["http:", "https:"])) {
      element.removeAttribute(attribute.name);
      continue;
    }

    if (tagName === "img" && name === "src") {
      element.setAttribute(attribute.name, resolveImageSrc(attribute.value));
    }

    if (name === "type" && tagName === "input" && attribute.value.toLowerCase() !== "checkbox") {
      element.remove();
    }
  }
}

function isSafeUrl(value: string, allowedProtocols: string[]): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return !/^[a-z][a-z0-9+.-]*:/.test(normalized) || allowedProtocols.some((protocol) => normalized.startsWith(protocol));
}

function resolveImageSrc(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("#") || trimmed.startsWith("//")) {
    return value;
  }

  return props.images?.[trimmed] ?? props.images?.[trimmed.replace(/\\/g, "/")] ?? value;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function plainText(value: string): string {
  const template = document.createElement("template");
  template.innerHTML = renderInline(value);
  return template.content.textContent ?? value;
}

function scrollToAnchor(hash: string) {
  const target = articleEl.value?.querySelector(`#${CSS.escape(hash)}`);
  if (target && typeof target.scrollIntoView === "function") {
    target.scrollIntoView({ block: "start" });
  }
}

async function showLinkToolbar(href: string, event: MouseEvent) {
  linkToolbar.value = { href, x: event.clientX, y: event.clientY + 8 };
  await nextTick();
  clampToolbarPosition();
}

function clampToolbarPosition() {
  const toolbar = toolbarEl.value;
  const state = linkToolbar.value;
  if (!toolbar || !state) return;

  const x = Math.max(4, Math.min(state.x, window.innerWidth - toolbar.offsetWidth - 4));
  const y = Math.max(4, Math.min(state.y, window.innerHeight - toolbar.offsetHeight - 4));
  linkToolbar.value = { ...state, x, y };
}

function closeLinkToolbar() {
  linkToolbar.value = null;
}

function openToolbarLink() {
  const target = toolbarTarget.value;
  if (!target) return;
  closeLinkToolbar();
  if (target.kind === "anchor") {
    scrollToAnchor(target.hash);
    return;
  }
  emit("openLink", target);
}

function handleClick(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target.closest("a") : null;
  const href = target?.getAttribute("href");
  if (!href) return;

  event.preventDefault();
  void showLinkToolbar(href, event);
}

function onDocPointer(event: PointerEvent) {
  const target = event.target as Node;
  if (toolbarEl.value?.contains(target)) return;
  closeLinkToolbar();
}

function onKey(event: KeyboardEvent) {
  if (event.key !== "Escape" || !linkToolbar.value) return;
  closeLinkToolbar();
  event.stopPropagation();
}

watch(linkToolbar, (value, previous) => {
  if (value && !previous) {
    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onKey);
  } else if (!value && previous) {
    document.removeEventListener("pointerdown", onDocPointer, true);
    document.removeEventListener("keydown", onKey);
  }
});

watch(() => props.content, closeLinkToolbar);

defineExpose({ scrollToAnchor });

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocPointer, true);
  document.removeEventListener("keydown", onKey);
});
</script>

<template>
  <article ref="articleEl" class="readme-render" aria-label="README 内容" @click="handleClick" v-html="renderedHtml" />
  <Teleport to="body">
    <div
      v-if="linkToolbar"
      ref="toolbarEl"
      class="readme-link-toolbar"
      role="toolbar"
      aria-label="链接操作"
      :style="{ left: `${linkToolbar.x}px`, top: `${linkToolbar.y}px` }"
    >
      <span class="readme-link-toolbar__href" :title="toolbarHref">{{ toolbarHref }}</span>
      <button type="button" class="readme-link-toolbar__button" :disabled="!toolbarCanOpen" @click="openToolbarLink">
        <ExternalLink :size="13" aria-hidden="true" />
        打开
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.readme-render {
  min-width: 0;
  color: var(--text);
  line-height: 1.65;
}

.readme-render :deep(h1),
.readme-render :deep(h2),
.readme-render :deep(h3),
.readme-render :deep(h4),
.readme-render :deep(h5),
.readme-render :deep(h6) {
  margin: 18px 0 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-soft);
  font-weight: 600;
  line-height: 1.3;
}

.readme-render :deep(h1:first-child),
.readme-render :deep(h2:first-child),
.readme-render :deep(h3:first-child) {
  margin-top: 0;
}

.readme-render :deep(h1) {
  font-size: 22px;
}

.readme-render :deep(h2) {
  font-size: 18px;
}

.readme-render :deep(h3) {
  font-size: 15px;
}

.readme-render :deep(p),
.readme-render :deep(ul),
.readme-render :deep(ol),
.readme-render :deep(blockquote),
.readme-render :deep(pre) {
  margin: 10px 0;
}

.readme-render :deep(ul),
.readme-render :deep(ol) {
  padding-left: 22px;
}

.readme-render :deep(li + li) {
  margin-top: 4px;
}

.readme-render :deep(li > input[type="checkbox"]) {
  width: 14px;
  height: 14px;
  margin: 0 7px 0 0;
  vertical-align: -2px;
}

.readme-render :deep(blockquote) {
  padding: 8px 12px;
  border-left: 3px solid var(--border-strong);
  color: var(--text-muted);
  background: var(--bg-subtle);
}

.readme-render :deep(a) {
  display: inline;
  height: auto;
  padding: 0;
  color: var(--accent);
  background: transparent;
  border: 0;
  font-weight: inherit;
  vertical-align: baseline;
}

.readme-render :deep(a:hover) {
  background: transparent;
  text-decoration: underline;
}

.readme-render :deep(img) {
  width: auto;
  height: auto;
  max-width: min(45%, 160px);
  max-height: 160px;
  object-fit: contain;
}

.readme-render :deep(:where(p > img:only-child, p > a:only-child img:only-child):not([width]):not([height])) {
  display: block;
  max-width: 90%;
  max-height: min(70vh, 640px);
  margin: 14px auto;
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  background: var(--bg-subtle);
}

.readme-link-toolbar {
  position: fixed;
  z-index: 2000;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: min(420px, calc(100vw - 8px));
  padding: 6px 6px 6px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--bg-elev);
  color: var(--text);
  box-shadow: 0 10px 28px -10px rgba(0, 0, 0, 0.55);
}

.readme-link-toolbar__href {
  min-width: 0;
  max-width: 300px;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.readme-link-toolbar__button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 9px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
</style>
