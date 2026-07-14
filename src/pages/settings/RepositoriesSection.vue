<script setup lang="ts">
import CancellableTasksCard from "./repositories/CancellableTasksCard.vue";
import ContributionIdentitiesCard from "./repositories/ContributionIdentitiesCard.vue";
import GitHubAuthorizationCard from "./repositories/GitHubAuthorizationCard.vue";
import SystemGitCredentialsCard from "./repositories/SystemGitCredentialsCard.vue";
import WorkspaceRepositoriesCard from "./repositories/WorkspaceRepositoriesCard.vue";
</script>

<template>
  <div data-agent-id="settings.repositories.page">
    <WorkspaceRepositoriesCard />
    <GitHubAuthorizationCard />
    <ContributionIdentitiesCard />
    <SystemGitCredentialsCard />
    <CancellableTasksCard />
  </div>
</template>
