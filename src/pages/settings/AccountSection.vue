<script setup lang="ts">
import { useWorkspace } from "../../composables/useWorkspace";
import AccountPreferencesCard from "./account/AccountPreferencesCard.vue";
import GitHubAccountProfileCard from "./account/GitHubAccountProfileCard.vue";
import GitHubAuthorizationCard from "./account/GitHubAuthorizationCard.vue";

const workspace = useWorkspace();
</script>

<template>
  <div data-agent-id="settings.account.page">
    <GitHubAuthorizationCard />
    <template v-if="workspace.githubBinding.value">
      <GitHubAccountProfileCard />
      <AccountPreferencesCard />
    </template>
  </div>
</template>
