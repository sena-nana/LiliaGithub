<script setup lang="ts">
/**
 * Nana Profile skeleton — real @lilia/ui + Lucide, mock binding (no MarkdownReadme).
 * Keeps the critical IIFE free of GitHubAccountProfileEditor / async markdown.
 */
import { AtSign, Globe2, MapPin, UserRound } from "@lucide/vue";
import { UiButton, UiCard } from "@lilia/ui";
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useWorkspace } from "../composables/useWorkspace";

const workspace = useWorkspace();
const router = useRouter();

const binding = computed(() => workspace.githubBinding.value);
const displayName = computed(
  () => binding.value?.login || "未绑定",
);
const login = computed(() => binding.value?.login || "—");
</script>

<template>
  <section class="nana-profile" data-agent-id="profile.page" data-page="profile">
    <UiCard class="nana-profile__card" data-agent-id="profile.skeleton">
      <header class="nana-profile__header">
        <div class="nana-profile__avatar" aria-hidden="true">
          <UserRound :size="28" />
        </div>
        <div class="nana-profile__meta">
          <h1 class="nana-profile__name">{{ displayName }}</h1>
          <p class="nana-profile__login">
            <AtSign :size="14" />
            <span>{{ login }}</span>
          </p>
        </div>
        <UiButton
          variant="ghost"
          data-agent-id="profile.open-settings"
          @click="router.push('/settings?tab=account')"
        >
          账户设置
        </UiButton>
      </header>

      <div v-if="binding" class="nana-profile__fields" data-agent-id="profile.fields">
        <div class="nana-profile__row">
          <MapPin :size="14" />
          <span>Mock · Nana Demo City</span>
        </div>
        <div class="nana-profile__row">
          <Globe2 :size="14" />
          <span>https://github.com/{{ login }}</span>
        </div>
        <p class="nana-profile__bio">
          Nana Profile 骨架：绑定账户 {{ login }}，完整编辑器与 README 仍走 Tauri 路径。
        </p>
      </div>
      <div v-else class="nana-profile__unavailable" role="status" data-agent-id="profile.unbound">
        <h2>GitHub 尚未绑定</h2>
        <p>完成账户绑定后即可查看和管理公开资料。</p>
      </div>
    </UiCard>
  </section>
</template>

<style scoped>
.nana-profile {
  min-width: 0;
  padding: 16px;
}

.nana-profile__card {
  width: min(100%, 720px);
  margin: 0 auto;
  padding: 16px;
}

.nana-profile__header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.nana-profile__avatar {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: var(--radius-md, 10px);
  background: var(--bg-subtle, #eef0f4);
  color: var(--text, #1a1d23);
}

.nana-profile__meta {
  flex: 1;
  min-width: 0;
}

.nana-profile__name {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text, #1a1d23);
}

.nana-profile__login {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 4px 0 0;
  color: var(--text-muted, #5c6575);
  font-size: 12px;
}

.nana-profile__fields {
  margin-top: 14px;
  display: grid;
  gap: 8px;
}

.nana-profile__row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted, #5c6575);
  font-size: 12px;
}

.nana-profile__bio {
  margin: 4px 0 0;
  color: var(--text, #1a1d23);
  font-size: 13px;
  line-height: 1.5;
}

.nana-profile__unavailable h2,
.nana-profile__unavailable p {
  margin: 0;
}

.nana-profile__unavailable {
  margin-top: 14px;
}

.nana-profile__unavailable h2 {
  color: var(--text, #1a1d23);
  font-size: 14px;
  font-weight: 600;
}

.nana-profile__unavailable p {
  margin-top: 4px;
  color: var(--text-muted, #5c6575);
  font-size: 12px;
}
</style>
