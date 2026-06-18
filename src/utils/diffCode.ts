export type DiffCodeLanguage =
  | "css"
  | "html"
  | "javascript"
  | "json"
  | "markdown"
  | "python"
  | "rust"
  | "shell"
  | "text"
  | "typescript"
  | "vue";

export type DiffCodeTokenType =
  | "comment"
  | "keyword"
  | "number"
  | "plain"
  | "property"
  | "punctuation"
  | "string"
  | "type";

export interface DiffCodeToken {
  type: DiffCodeTokenType;
  text: string;
}

const LANGUAGE_BY_EXTENSION: Record<string, DiffCodeLanguage> = {
  bash: "shell",
  cjs: "javascript",
  css: "css",
  htm: "html",
  html: "html",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  md: "markdown",
  mjs: "javascript",
  py: "python",
  pyw: "python",
  rs: "rust",
  sh: "shell",
  ts: "typescript",
  tsx: "typescript",
  vue: "vue",
};

const KEYWORDS = new Set([
  "and",
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "crate",
  "def",
  "default",
  "elif",
  "else",
  "enum",
  "except",
  "export",
  "extends",
  "false",
  "False",
  "finally",
  "fn",
  "for",
  "from",
  "function",
  "if",
  "impl",
  "implements",
  "import",
  "in",
  "interface",
  "is",
  "lambda",
  "let",
  "match",
  "mod",
  "move",
  "mut",
  "new",
  "None",
  "not",
  "null",
  "or",
  "pass",
  "private",
  "protected",
  "pub",
  "public",
  "raise",
  "readonly",
  "return",
  "self",
  "static",
  "struct",
  "super",
  "switch",
  "then",
  "throw",
  "trait",
  "true",
  "True",
  "try",
  "type",
  "typeof",
  "use",
  "var",
  "where",
  "while",
  "with",
  "yield",
]);

export function inferDiffCodeLanguage(filePath: string): DiffCodeLanguage {
  const extension = filePath.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase();
  return extension ? LANGUAGE_BY_EXTENSION[extension] ?? "text" : "text";
}

export function tokenizeDiffCodeLines(content: string, language: DiffCodeLanguage) {
  return content.split("\n").map((line, index) => ({
    index,
    tokens: tokenizeDiffCodeLine(line, language),
  }));
}

export function tokenizeDiffCodeLine(line: string, language: DiffCodeLanguage): DiffCodeToken[] {
  if (!line) return [{ type: "plain", text: "" }];
  if (language === "text") return [{ type: "plain", text: line }];
  if (language === "markdown") return tokenizeMarkdown(line);
  if (language === "html" || (language === "vue" && /^\s*<\/?[A-Za-z][\w:-]*/.test(line))) {
    return tokenizeMarkup(line);
  }
  return tokenizeGeneric(line, language);
}

function tokenizeMarkdown(line: string): DiffCodeToken[] {
  const block = /^(\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.))(\s+.*)$/.exec(line);
  if (!block) return tokenizeMarkdownInline(line);
  return [
    { type: block[1].trim() === ">" ? "punctuation" : "keyword", text: block[1] },
    ...tokenizeMarkdownInline(block[2]),
  ];
}

function tokenizeMarkdownInline(line: string): DiffCodeToken[] {
  return tokenizeByPattern(line, /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|https?:\/\/\S+)/g, (text) => {
    if (text.startsWith("`")) return "string";
    if (text.startsWith("**")) return "type";
    return "property";
  });
}

function tokenizeMarkup(line: string): DiffCodeToken[] {
  const tokens: DiffCodeToken[] = [];
  let inTag = false;

  for (const part of line.match(/(<\/?|\/?>|=|"[^"]*"|'[^']*'|[A-Za-z][\w:-]*|\s+|.)/g) ?? []) {
    if (/^<\/?$/.test(part)) {
      pushToken(tokens, "punctuation", part);
      inTag = true;
    } else if (/^\/?>$/.test(part)) {
      pushToken(tokens, "punctuation", part);
      inTag = false;
    } else if (part === "=") {
      pushToken(tokens, "punctuation", part);
    } else if (/^["']/.test(part)) {
      pushToken(tokens, "string", part);
    } else if (/^[A-Za-z][\w:-]*$/.test(part) && inTag) {
      pushToken(tokens, "type", part);
    } else {
      pushToken(tokens, "plain", part);
    }
  }

  return tokens;
}

function tokenizeGeneric(line: string, language: DiffCodeLanguage): DiffCodeToken[] {
  const tokens: DiffCodeToken[] = [];
  let cursor = 0;

  while (cursor < line.length) {
    const text = line.slice(cursor);
    const token = nextGenericToken(text, language);
    pushToken(tokens, token.type, token.text);
    cursor += token.text.length;
  }

  return tokens;
}

function nextGenericToken(text: string, language: DiffCodeLanguage): DiffCodeToken {
  const comment = matchComment(text, language);
  if (comment) return { type: "comment", text: comment };

  const string = /^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/.exec(text)?.[0];
  if (string) return { type: /^"(?:\\.|[^"\\])*"(?=\s*:)/.test(text) ? "property" : "string", text: string };

  const word = /^[A-Za-z_$][\w$]*/.exec(text)?.[0];
  if (word) {
    if (KEYWORDS.has(word)) return { type: "keyword", text: word };
    if (/^[A-Z]/.test(word)) return { type: "type", text: word };
    if (new RegExp(`^${escapeRegExp(word)}(?=\\s*:)`).test(text)) return { type: "property", text: word };
    return { type: "plain", text: word };
  }

  const number = /^\d+(?:\.\d+)?/.exec(text)?.[0];
  if (number) return { type: "number", text: number };

  const punctuation = /^[{}()[\]<>,.:;=+\-*/%!?|&]/.exec(text)?.[0];
  return { type: punctuation ? "punctuation" : "plain", text: punctuation ?? text[0] };
}

function tokenizeByPattern(
  line: string,
  pattern: RegExp,
  typeFor: (text: string) => DiffCodeTokenType,
): DiffCodeToken[] {
  const tokens: DiffCodeToken[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line))) {
    if (match.index > cursor) pushToken(tokens, "plain", line.slice(cursor, match.index));
    pushToken(tokens, typeFor(match[0]), match[0]);
    cursor = match.index + match[0].length;
  }

  if (cursor < line.length) pushToken(tokens, "plain", line.slice(cursor));
  return tokens.length ? tokens : [{ type: "plain", text: line }];
}

function matchComment(text: string, language: DiffCodeLanguage): string | null {
  if (language === "python" || language === "shell") return /^#.*/.exec(text)?.[0] ?? null;
  if (language === "css") return /^\/\*.*?\*\//.exec(text)?.[0] ?? null;
  return /^(\/\/.*|\/\*.*?\*\/)/.exec(text)?.[0] ?? null;
}

function pushToken(tokens: DiffCodeToken[], type: DiffCodeTokenType, text: string) {
  if (!text) return;
  const previous = tokens[tokens.length - 1];
  if (previous?.type === type) {
    previous.text += text;
  } else {
    tokens.push({ type, text });
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
