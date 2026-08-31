<script setup lang="ts">
/**
 * Nana Settings · About — real app metadata (not Appearance stub).
 * Aligns with Lilia AboutSection agent-ids; license list is summarized for Nana.
 */
import { computed } from "vue";
import { NanaSettingsCard, NanaSettingsRow } from "@nanaui/nanavue-components";
import appConfig from "../../../app.config.json";
import openSourceLicenseManifest from "../../generated/openSourceLicenseManifest.json";

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

const manifest = openSourceLicenseManifest as OpenSourceLicenseManifest | null;

const hasLicenseManifest = computed(
  () =>
    Boolean(manifest?.app?.name) &&
    Array.isArray(manifest?.npmDependencies) &&
    Array.isArray(manifest?.rustDependencies),
);

const appName = computed(
  () => manifest?.app?.name || appConfig.productTitle || appConfig.appName || "LiliaGithub",
);
const appVersion = computed(
  () => manifest?.app?.version || appConfig.version || "1.0.0",
);
const appLicense = computed(() => manifest?.app?.license || "MIT");
const npmCount = computed(() => manifest?.npmDependencies?.length ?? 0);
const rustCount = computed(() => manifest?.rustDependencies?.length ?? 0);
const sampleLicenses = computed(() => {
  const npm = manifest?.npmDependencies ?? [];
  const rust = manifest?.rustDependencies ?? [];
  return [...npm.slice(0, 4), ...rust.slice(0, 4)];
});
</script>

<template>
  <div class="nana-about-section" data-agent-id="settings.about.page">
    <NanaSettingsCard title="关于" agent-id="settings.about.main">
      <NanaSettingsRow
        label="名称"
        first-in-group
        divided
        agent-id="settings.about.name"
      >
        <span>{{ appName }}</span>
      </NanaSettingsRow>
      <NanaSettingsRow label="版本" divided agent-id="settings.about.version">
        <span>{{ appVersion }}</span>
      </NanaSettingsRow>
      <NanaSettingsRow
        label="许可证"
        last-in-group
        agent-id="settings.about.license"
      >
        <span>{{ appLicense }}</span>
      </NanaSettingsRow>
    </NanaSettingsCard>

    <NanaSettingsCard
      title="第三方许可证"
      agent-id="settings.about.licenses"
      aria-label="第三方许可证协议"
    >
      <template v-if="hasLicenseManifest">
        <NanaSettingsRow
          label="依赖汇总"
          :hint="`npm ${npmCount} · Rust ${rustCount}`"
          :divided="sampleLicenses.length > 0"
          first-in-group
          :last-in-group="sampleLicenses.length === 0"
          agent-id="settings.about.licenses.summary"
        />
        <NanaSettingsRow
          v-for="(dependency, index) in sampleLicenses"
          :key="`${dependency.name}-${index}`"
          :label="dependency.name"
          :hint="dependency.version"
          :divided="index < sampleLicenses.length - 1"
          :last-in-group="index === sampleLicenses.length - 1"
          :agent-id="`settings.about.licenses.item.${dependency.name}`"
        >
          <span>{{ dependency.license }}</span>
        </NanaSettingsRow>
      </template>
      <NanaSettingsRow
        v-else
        label="许可清单"
        hint="未生成许可清单，请重试 yarn about:licenses"
        first-in-group
        last-in-group
        agent-id="settings.about.licenses.fallback"
      />
    </NanaSettingsCard>
  </div>
</template>

<style scoped>
.nana-about-section {
  display: grid;
  gap: 12px;
  min-width: 0;
}
</style>
