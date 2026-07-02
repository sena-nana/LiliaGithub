<template>
  <div class="about-page">
    <section class="card about-main">
    <h2>关于</h2>
    <ul class="kv">
      <li><span>名称</span><span>{{ appName }}</span></li>
      <li class="about-version-row">
        <span>版本</span>
        <span>
          <span class="about-version-value">{{ appVersion }}</span>
          <button
            type="button"
            class="primary about-version-action"
            data-agent-id="settings.about.release.check"
            :disabled="checking"
            @click="checkForUpdate"
          >
            {{ checking ? "检查中" : "检查更新" }}
          </button>
          <button
            v-if="updateCheckState === 'available'"
            type="button"
            class="primary about-version-action"
            data-agent-id="settings.about.release.open"
            :disabled="checking"
            @click="openLatestRelease"
          >
            打开下载页
          </button>
        </span>
      </li>
    </ul>
    <p v-if="updateMessage" class="about-update-status" :class="`is-${updateCheckState}`">
      {{ updateMessage }}
    </p>
    </section>
    <section class="card about-license-third-party" aria-label="第三方许可证协议">
      <template v-if="hasLicenseManifest">
        <details class="about-license-details">
          <summary class="about-license-summary">
            <span>第三方许可证协议</span>
            <ChevronRight
              :size="13"
              aria-hidden="true"
              class="sb-group-toggle__chevron"
            />
          </summary>
          <div v-if="npmDependencies.length">
            <ul class="kv about-license-list">
              <li v-for="dependency in npmDependencies" :key="`npm-dep-${dependency.name}`">
                <span>{{ dependency.name }}</span>
                <span>{{ dependency.license }}</span>
              </li>
            </ul>
          </div>
          <div v-if="rustDependencies.length">
            <ul class="kv about-license-list">
              <li v-for="dependency in rustDependencies" :key="`rust-dep-${dependency.name}`">
                <span>{{ dependency.name }}</span>
                <span>{{ dependency.license }}</span>
              </li>
            </ul>
          </div>
          <div v-if="!npmDependencies.length && !rustDependencies.length" class="about-license-empty">
            未发现可汇总的依赖记录。
          </div>
        </details>
      </template>
      <p v-else class="about-license-fallback">未生成许可清单，请重试 yarn about:licenses</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { ChevronRight } from "@lucide/vue";
import { openUrl } from "../../services/workspace/client";
import openSourceLicenseManifest from "../../generated/openSourceLicenseManifest.json";

const LILIA_GITHUB_RELEASES_API = "https://api.github.com/repos/sena-nana/LiliaGithub/releases?per_page=10";
const LILIA_GITHUB_LATEST_RELEASE_PAGE = "https://github.com/sena-nana/LiliaGithub/releases/latest";

interface OpenSourceLicenseManifestDependency {
  name: string;
  version: string;
  license: string;
}

interface OpenSourceLicenseManifest {
  app?: {
    name?: string;
    version?: string;
    license?: string;
  };
  npmDependencies?: OpenSourceLicenseManifestDependency[];
  rustDependencies?: OpenSourceLicenseManifestDependency[];
}

interface GitHubReleaseResponse {
  tag_name?: string;
  draft?: boolean;
}

interface ParsedVersion {
  core: [number, number, number];
  prerelease: string[];
}

type UpdateCheckState = "idle" | "available" | "current" | "error";

const manifest = openSourceLicenseManifest as OpenSourceLicenseManifest | null;

const hasLicenseManifest = computed(() => {
  return (
    Boolean(manifest?.app?.name) &&
    Array.isArray(manifest?.npmDependencies) &&
    Array.isArray(manifest?.rustDependencies)
  );
});

const appName = computed(() => manifest?.app?.name || "LiliaGithub");
const appVersion = computed(() => manifest?.app?.version ?? "1.0.0");
const npmDependencies = computed(() => manifest?.npmDependencies ?? []);
const rustDependencies = computed(() => manifest?.rustDependencies ?? []);
const checking = ref(false);
const updateCheckState = ref<UpdateCheckState>("idle");
const latestReleaseVersion = ref<string | null>(null);
const updateMessage = computed(() => {
  if (updateCheckState.value === "available" && latestReleaseVersion.value) {
    return `发现新版本 ${latestReleaseVersion.value}。`;
  }
  if (updateCheckState.value === "current") return "当前已是最新版本。";
  if (updateCheckState.value === "error") return "检查失败，请稍后重试。";
  return "";
});

async function checkForUpdate() {
  checking.value = true;
  updateCheckState.value = "idle";
  latestReleaseVersion.value = null;
  try {
    const release = await fetchLatestRelease();
    const latest = parseVersion(release.tag_name);
    const current = parseVersion(appVersion.value);
    if (!latest || !current) throw new Error("Invalid release version");
    latestReleaseVersion.value = release.tag_name ?? null;
    updateCheckState.value = compareVersions(latest, current) > 0 ? "available" : "current";
  } catch {
    updateCheckState.value = "error";
  } finally {
    checking.value = false;
  }
}

async function openLatestRelease() {
  await openUrl(LILIA_GITHUB_LATEST_RELEASE_PAGE);
}

async function fetchLatestRelease(): Promise<GitHubReleaseResponse> {
  if (typeof fetch !== "function") throw new Error("Fetch is unavailable");
  const response = await fetch(LILIA_GITHUB_RELEASES_API, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error("GitHub release request failed");
  const releases = await response.json();
  if (!Array.isArray(releases)) throw new Error("Invalid GitHub release response");
  const latest = releases.find(isComparableRelease);
  if (!latest) throw new Error("No valid GitHub release");
  return latest;
}

function isComparableRelease(value: unknown): value is GitHubReleaseResponse {
  if (!value || typeof value !== "object") return false;
  const release = value as GitHubReleaseResponse;
  return typeof release.tag_name === "string" && release.draft !== true && parseVersion(release.tag_name) !== null;
}

function parseVersion(value: string | null | undefined): ParsedVersion | null {
  const normalized = value?.trim().replace(/^v/i, "");
  if (!normalized) return null;
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(normalized);
  if (!match) return null;
  return {
    core: [Number.parseInt(match[1], 10), Number.parseInt(match[2], 10), Number.parseInt(match[3], 10)],
    prerelease: match[4]?.split(".") ?? [],
  };
}

function compareVersions(left: ParsedVersion, right: ParsedVersion) {
  for (let index = 0; index < left.core.length; index += 1) {
    const diff = left.core[index] - right.core[index];
    if (diff !== 0) return diff;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

function comparePrerelease(left: string[], right: string[]) {
  if (!left.length && !right.length) return 0;
  if (!left.length) return 1;
  if (!right.length) return -1;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === rightPart) continue;
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Number.parseInt(leftPart, 10) - Number.parseInt(rightPart, 10);
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}
</script>

<style scoped>
.about-page {
  display: grid;
  gap: 12px;
}

.about-version-row > span:last-child {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
  align-items: center;
}

.about-version-action {
  height: 22px;
  padding: 0 8px;
  font-size: 12px;
  line-height: 1;
}

.about-update-status {
  margin: 10px 0 0;
  color: var(--text-muted);
  font-size: 13px;
}

.about-update-status.is-available {
  color: var(--accent);
}

.about-update-status.is-error {
  color: var(--err);
}

.about-license-fallback {
  margin: 0 0 8px;
  color: var(--muted);
  font-size: 13px;
}

.about-license-empty {
  font-size: 13px;
  color: var(--muted);
}

.about-license-list {
  font-size: 12px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 2px 12px;
}

.about-license-list li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-soft);
  padding: 6px 0;
}

.about-license-details summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  list-style: none;
  margin: 6px 0;
  cursor: pointer;
  padding: 0;
  line-height: normal;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.about-license-details > summary .sb-group-toggle__chevron {
  flex: 0 0 auto;
  transition: transform 0.12s ease;
  color: currentColor;
}

.about-license-details[open] > summary .sb-group-toggle__chevron {
  transform: rotate(90deg);
}

.about-license-details > summary::-webkit-details-marker {
  display: none;
}

.about-license-details summary ~ div,
.about-license-details summary ~ p,
.about-license-details summary ~ ul {
  margin-top: 6px;
}

.about-license-details summary:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 58%, transparent);
  outline-offset: 2px;
}

@media (max-width: 720px) {
  .about-version-row > span:last-child {
    justify-content: flex-start;
  }
}
</style>
