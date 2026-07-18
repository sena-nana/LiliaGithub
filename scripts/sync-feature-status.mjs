import { readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(repoRoot, "docs/feature-status.json");
const checkOnly = process.argv.includes("--check");
const supportedArgs = new Set(["--check"]);
const unexpectedArgs = process.argv.slice(2).filter((arg) => !supportedArgs.has(arg));

if (unexpectedArgs.length) {
  throw new Error(`Unsupported argument: ${unexpectedArgs.join(", ")}`);
}

const targets = [
  {
    path: resolve(repoRoot, "README.md"),
    locale: "en",
    heading: "Feature Status",
    nextHeading: "Project Structure",
    sourceLabel: "docs/feature-status.json",
    intro: (lastChecked) =>
      `The list below is generated from the project's canonical feature-status data. Only user-facing capabilities available on the current main branch are marked complete. Last checked: ${lastChecked}.`,
  },
  {
    path: resolve(repoRoot, "README.zh-CN.md"),
    locale: "zh-CN",
    heading: "功能状态",
    nextHeading: "项目结构",
    sourceLabel: "docs/feature-status.json",
    intro: (lastChecked) =>
      `以下内容由项目的 Feature Status 单一真值生成。只有当前 main 分支上可用的用户功能才会标记为完成。最近核对时间：${lastChecked}。`,
  },
];

function localized(value, locale, context) {
  const text = value?.[locale];
  if (typeof text !== "string" || !text.trim()) {
    throw new Error(`${context} is missing a non-empty ${locale} value`);
  }
  return text.trim();
}

function validateStatus(status) {
  if (!status || typeof status !== "object" || Array.isArray(status)) {
    throw new Error("Feature status source must contain an object");
  }
  if (typeof status.lastChecked !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(status.lastChecked)) {
    throw new Error("lastChecked must use YYYY-MM-DD");
  }
  if (!Array.isArray(status.sections) || status.sections.length === 0) {
    throw new Error("sections must be a non-empty array");
  }

  const sectionIds = new Set();
  const itemIds = new Set();
  for (const section of status.sections) {
    if (typeof section.id !== "string" || !section.id.trim() || sectionIds.has(section.id)) {
      throw new Error(`Invalid or duplicate section id: ${String(section.id)}`);
    }
    sectionIds.add(section.id);
    localized(section.title, "en", `section ${section.id} title`);
    localized(section.title, "zh-CN", `section ${section.id} title`);
    if (!Array.isArray(section.items) || section.items.length === 0) {
      throw new Error(`section ${section.id} must contain items`);
    }
    for (const item of section.items) {
      if (typeof item.id !== "string" || !item.id.trim() || itemIds.has(item.id)) {
        throw new Error(`Invalid or duplicate item id: ${String(item.id)}`);
      }
      itemIds.add(item.id);
      if (typeof item.complete !== "boolean") {
        throw new Error(`item ${item.id} must declare a boolean complete value`);
      }
      if (item.complete && item.milestone != null) {
        throw new Error(`completed item ${item.id} must not declare a milestone`);
      }
      if (!item.complete && (typeof item.milestone !== "string" || !item.milestone.trim())) {
        throw new Error(`incomplete item ${item.id} must declare a milestone`);
      }
      localized(item.text, "en", `item ${item.id} text`);
      localized(item.text, "zh-CN", `item ${item.id} text`);
    }
  }
}

function renderStatus(status, target) {
  const generatedNotice = target.locale === "en"
    ? `<!-- Generated from ${target.sourceLabel} by scripts/sync-feature-status.mjs. Edit the source, then run pnpm feature-status:generate. -->`
    : `<!-- 由 ${target.sourceLabel} 通过 scripts/sync-feature-status.mjs 生成。请修改数据源后运行 pnpm feature-status:generate。 -->`;
  const sections = status.sections.map((section) => {
    const lines = section.items.map((item) => {
      const checkbox = item.complete ? "x" : " ";
      const milestone = item.complete ? "" : ` \`${item.milestone}\``;
      return `- [${checkbox}] ${localized(item.text, target.locale, `item ${item.id} text`)}${milestone}`;
    });
    return `### ${localized(section.title, target.locale, `section ${section.id} title`)}\n\n${lines.join("\n")}`;
  });

  return [
    `## ${target.heading}`,
    "",
    generatedNotice,
    "",
    target.intro(status.lastChecked),
    "",
    sections.join("\n\n"),
  ].join("\n");
}

function replaceFeatureStatus(readme, target, rendered) {
  const startMarker = `## ${target.heading}`;
  const endMarker = `## ${target.nextHeading}`;
  const start = readme.indexOf(startMarker);
  const end = readme.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`${target.path} is missing the expected ${target.heading} section boundary`);
  }
  const newline = readme.includes("\r\n") ? "\r\n" : "\n";
  const renderedWithLocalNewlines = rendered.replaceAll("\n", newline);
  return `${readme.slice(0, start)}${renderedWithLocalNewlines}${newline}${newline}${readme.slice(end)}`;
}

const status = JSON.parse(await readFile(sourcePath, "utf8"));
validateStatus(status);

const plans = await Promise.all(targets.map(async (target) => {
  const current = await readFile(target.path, "utf8");
  const expected = replaceFeatureStatus(current, target, renderStatus(status, target));
  return { ...target, current, expected };
}));
const staleTargets = plans.filter(({ current, expected }) => current !== expected);

if (staleTargets.length) {
  if (checkOnly) {
    const files = staleTargets.map(({ path }) => relative(repoRoot, path)).join(", ");
    throw new Error(`Generated feature status is out of date: ${files}. Run pnpm feature-status:generate.`);
  }
  await Promise.all(staleTargets.map(({ path, expected }) => writeFile(path, expected, "utf8")));
}

if (!checkOnly) {
  console.log(staleTargets.length
    ? "Updated README feature status from docs/feature-status.json."
    : "README feature status is already up to date.");
}
