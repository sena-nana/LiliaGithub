<script setup lang="ts">
import { useWorkspace } from "../../composables/useWorkspace";
import AccountPreferencesCard from "./account/AccountPreferencesCard.vue";
import GitHubAccountProfileCard from "./account/GitHubAccountProfileCard.vue";
import GitHubAuthorizationCard from "./account/GitHubAuthorizationCard.vue";
import GitHubWatchedRepositoriesCard from "./account/GitHubWatchedRepositoriesCard.vue";

const workspace = useWorkspace();
</script>

<template>
  <div data-agent-id="settings.account.page">
    <GitHubAuthorizationCard />
    <template v-if="workspace.githubBinding.value">
      <GitHubAccountProfileCard />
      <GitHubWatchedRepositoriesCard />
      <AccountPreferencesCard />
    </template>
  </div>
</template>
