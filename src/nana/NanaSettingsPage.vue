<script setup lang="ts">
/**
 * Nana Settings page container — replaces @lilia/ui LiliaSettingsPage chrome.
 * Resolves tabs via Lilia settings model; section bodies are NanaAppearancePanel /
 * NanaAccountSection / NanaWorkspaceSection / NanaAboutSection.
 */
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useLiliaSettings } from "@lilia/ui/settings";
import { NanaSettingsPage as NanaSettingsPageView } from "@nanaui/nanavue-components";

const route = useRoute();
const settings = useLiliaSettings();
if (!settings) {
  throw new Error("NanaSettingsPage requires provideLiliaSettings().");
}
const tab = computed(() => route.query.tab);
</script>

<template>
  <NanaSettingsPageView
    :settings="settings"
    :tab="tab"
    data-agent-id="settings.page.nana"
  />
</template>
