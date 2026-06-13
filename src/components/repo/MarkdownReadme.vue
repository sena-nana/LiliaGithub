<script setup lang="ts">
import { computed } from "vue";

type InlineToken =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

type MarkdownBlock =
  | { kind: "heading"; level: number; tokens: InlineToken[] }
  | { kind: "paragraph"; tokens: InlineToken[] }
  | { kind: "quote"; tokens: InlineToken[] }
  | { kind: "list"; ordered: boolean; items: InlineToken[][] }
  | { kind: "code"; text: string };

const props = defineProps<{
  content: string;
}>();

const emit = defineEmits<{
  openLink: [href: string];
}>();

const blocks = computed(() => parseMarkdown(props.content));

function parseMarkdown(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const parsed: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let codeLines: string[] | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    parsed.push({ kind: "paragraph", tokens: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    parsed.push({ kind: "list", ordered: list.ordered, items: list.items.map(parseInline) });
    list = null;
  };

  for (const line of lines) {
    if (codeLines) {
      if (/^```/.test(line.trim())) {
        parsed.push({ kind: "code", text: codeLines.join("\n") });
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

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      parsed.push({ kind: "heading", level: heading[1].length, tokens: parseInline(heading[2]) });
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
      parsed.push({ kind: "quote", tokens: parseInline(quote[1]) });
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  if (codeLines) parsed.push({ kind: "code", text: codeLines.join("\n") });
  flushParagraph();
  flushList();
  return parsed;
}

function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const pattern = /(`[^`]+`)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) tokens.push({ kind: "text", text: text.slice(cursor, match.index) });
    if (match[1]) {
      tokens.push({ kind: "code", text: match[1].slice(1, -1) });
    } else {
      tokens.push({ kind: "link", text: match[3], href: match[4] });
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) tokens.push({ kind: "text", text: text.slice(cursor) });
  return tokens;
}

function openLink(href: string) {
  emit("openLink", href);
}
</script>

<template>
  <article class="readme-render" aria-label="README 内容">
    <template v-for="(block, index) in blocks" :key="index">
      <component
        :is="`h${block.level}`"
        v-if="block.kind === 'heading'"
      >
        <template v-for="(token, tokenIndex) in block.tokens" :key="tokenIndex">
          <code v-if="token.kind === 'code'">{{ token.text }}</code>
          <button v-else-if="token.kind === 'link'" type="button" class="readme-link" @click="openLink(token.href)">
            {{ token.text }}
          </button>
          <template v-else>{{ token.text }}</template>
        </template>
      </component>

      <p v-else-if="block.kind === 'paragraph'">
        <template v-for="(token, tokenIndex) in block.tokens" :key="tokenIndex">
          <code v-if="token.kind === 'code'">{{ token.text }}</code>
          <button v-else-if="token.kind === 'link'" type="button" class="readme-link" @click="openLink(token.href)">
            {{ token.text }}
          </button>
          <template v-else>{{ token.text }}</template>
        </template>
      </p>

      <blockquote v-else-if="block.kind === 'quote'">
        <template v-for="(token, tokenIndex) in block.tokens" :key="tokenIndex">
          <code v-if="token.kind === 'code'">{{ token.text }}</code>
          <button v-else-if="token.kind === 'link'" type="button" class="readme-link" @click="openLink(token.href)">
            {{ token.text }}
          </button>
          <template v-else>{{ token.text }}</template>
        </template>
      </blockquote>

      <component :is="block.ordered ? 'ol' : 'ul'" v-else-if="block.kind === 'list'">
        <li v-for="(item, itemIndex) in block.items" :key="itemIndex">
          <template v-for="(token, tokenIndex) in item" :key="tokenIndex">
            <code v-if="token.kind === 'code'">{{ token.text }}</code>
            <button v-else-if="token.kind === 'link'" type="button" class="readme-link" @click="openLink(token.href)">
              {{ token.text }}
            </button>
            <template v-else>{{ token.text }}</template>
          </template>
        </li>
      </component>

      <pre v-else><code>{{ block.text }}</code></pre>
    </template>
  </article>
</template>

<style scoped>
.readme-render {
  min-width: 0;
  color: var(--text);
  line-height: 1.65;
}

.readme-render h1,
.readme-render h2,
.readme-render h3,
.readme-render h4,
.readme-render h5,
.readme-render h6 {
  margin: 18px 0 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-soft);
  font-weight: 600;
  line-height: 1.3;
}

.readme-render h1:first-child,
.readme-render h2:first-child,
.readme-render h3:first-child {
  margin-top: 0;
}

.readme-render h1 {
  font-size: 22px;
}

.readme-render h2 {
  font-size: 18px;
}

.readme-render h3 {
  font-size: 15px;
}

.readme-render p,
.readme-render ul,
.readme-render ol,
.readme-render blockquote,
.readme-render pre {
  margin: 10px 0;
}

.readme-render ul,
.readme-render ol {
  padding-left: 22px;
}

.readme-render li + li {
  margin-top: 4px;
}

.readme-render blockquote {
  padding: 8px 12px;
  border-left: 3px solid var(--border-strong);
  color: var(--text-muted);
  background: var(--bg-subtle);
}

.readme-link {
  display: inline;
  height: auto;
  padding: 0;
  color: var(--accent);
  background: transparent;
  border: 0;
  font-weight: inherit;
  vertical-align: baseline;
}

.readme-link:hover {
  background: transparent;
  text-decoration: underline;
}
</style>
