<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  content: string;
}>();

const emit = defineEmits<{
  openLink: [href: string];
}>();

const renderedHtml = computed(() => sanitizeHtml(renderMarkdown(props.content)));

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
  img: new Set(["alt", "height", "src", "width"]),
  input: new Set(["checked", "disabled", "type"]),
};

function renderMarkdown(content: string): string {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let codeLines: string[] | null = null;
  let htmlLines: string[] | null = null;
  let htmlEndTag: RegExp | null = null;

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
      codeLines = [];
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const htmlBlock = getHtmlBlock(line);
    if (htmlBlock) {
      flushParagraph();
      flushList();
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
      blocks.push("<hr>");
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    const listItem = /^(\s*)([-*+]|\d+\.)\s+(.+)$/.exec(line);
    if (listItem) {
      flushParagraph();
      const ordered = /\d+\./.test(listItem[2]);
      if (!list || list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push(listItem[3]);
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      flushList();
      blocks.push(`<blockquote>${renderInline(quote[1])}</blockquote>`);
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  if (codeLines) blocks.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  flushParagraph();
  flushList();
  return blocks.join("");
}

function renderInline(text: string): string {
  const pattern = /(`[^`]+`)|(!\[([^\]]*)\]\(([^)]+)\))|(\[([^\]]+)\]\(([^)]+)\))|(<\/?[A-Za-z][^>]*>)/g;
  let html = "";
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > cursor) html += escapeHtml(text.slice(cursor, match.index));
    if (match[1]) {
      html += `<code>${escapeHtml(match[1].slice(1, -1))}</code>`;
    } else if (match[2]) {
      html += `<img src="${escapeAttribute(match[4])}" alt="${escapeAttribute(match[3])}">`;
    } else if (match[5]) {
      html += `<a href="${escapeAttribute(match[7])}">${renderInline(match[6])}</a>`;
    } else {
      html += match[8];
    }
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) html += escapeHtml(text.slice(cursor));
  return html;
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

    if (name === "src" && !isSafeUrl(attribute.value, ["http:", "https:"])) {
      element.removeAttribute(attribute.name);
      continue;
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

function handleClick(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target.closest("a") : null;
  const href = target?.getAttribute("href");
  if (!href) return;

  event.preventDefault();
  emit("openLink", href);
}
</script>

<template>
  <article class="readme-render" aria-label="README 内容" @click="handleClick" v-html="renderedHtml" />
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
</style>
