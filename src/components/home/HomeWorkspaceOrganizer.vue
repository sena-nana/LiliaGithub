<script setup lang="ts">
import { FolderGit2, Star, X } from "@lucide/vue";
import type { FavoriteRepositoryEntry } from "../../utils/repoFavorites";

export interface HomeWorkspaceGroupItem {
  repoId: string;
  name: string;
  title: string;
}

export interface HomeWorkspaceGroup {
  id: string;
  name: string;
  items: HomeWorkspaceGroupItem[];
}

defineProps<{
  favorites: readonly FavoriteRepositoryEntry[];
  groups: readonly HomeWorkspaceGroup[];
  favoriteError?: string | null;
}>();

defineEmits<{
  openFavorite: [favorite: FavoriteRepositoryEntry];
  removeFavorite: [favorite: FavoriteRepositoryEntry];
  openRepo: [repoId: string];
}>();
</script>

<template>
  <section class="card workspace-organizer" aria-label="收藏与常用工作区">
    <div class="workspace-organizer__section">
      <div class="workspace-organizer__heading">
        <Star :size="14" aria-hidden="true" />
        <h2>收藏仓库</h2>
        <span>{{ favorites.length }}</span>
      </div>
      <p v-if="!favorites.length" class="workspace-organizer__empty">从仓库列表或侧栏收藏常用仓库。</p>
      <p v-if="favoriteError" class="workspace-organizer__error">{{ favoriteError }}</p>
      <div v-else class="workspace-organizer__rows">
        <div v-for="favorite in favorites" :key="favorite.key" class="workspace-organizer__row">
          <button
            type="button"
            class="workspace-organizer__main"
            :data-agent-id="`home.favorite.${favorite.key}.open`"
            :aria-label="`打开收藏 ${favorite.name}`"
            :title="favorite.title"
            @click="$emit('openFavorite', favorite)"
          >
            <Star :size="13" aria-hidden="true" class="workspace-organizer__star" />
            <span>{{ favorite.name }}</span>
            <small>{{ favorite.localRepo ? "本地" : "远程" }}</small>
          </button>
          <button
            type="button"
            class="workspace-organizer__remove"
            :data-agent-id="`home.favorite.${favorite.key}.remove`"
            :aria-label="`取消收藏 ${favorite.name}`"
            title="取消收藏"
            @click="$emit('removeFavorite', favorite)"
          >
            <X :size="13" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>

    <div class="workspace-organizer__section">
      <div class="workspace-organizer__heading">
        <FolderGit2 :size="14" aria-hidden="true" />
        <h2>常用工作区</h2>
        <span>{{ groups.length }}</span>
      </div>
      <p v-if="!groups.length" class="workspace-organizer__empty">在侧栏创建分组并整理本地仓库。</p>
      <div v-else class="workspace-organizer__groups">
        <section v-for="group in groups" :key="group.id" class="workspace-organizer__group">
          <h3>{{ group.name }} <span>{{ group.items.length }}</span></h3>
          <p v-if="!group.items.length" class="workspace-organizer__group-empty">暂无仓库</p>
          <button
            v-for="repo in group.items"
            :key="repo.repoId"
            type="button"
            class="workspace-organizer__repo"
            :data-agent-id="`home.workspace-group.${group.id}.${repo.repoId}`"
            :aria-label="`打开工作区 ${group.name} / ${repo.name}`"
            :title="repo.title"
            @click="$emit('openRepo', repo.repoId)"
          >
            {{ repo.name }}
          </button>
        </section>
      </div>
    </div>
  </section>
</template>

<style scoped>
.workspace-organizer {
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
  gap: 16px;
  padding: 12px;
  min-height: 0;
}

.workspace-organizer__section {
  min-width: 0;
}

.workspace-organizer__heading {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
  color: var(--text-muted);
}

.workspace-organizer__heading h2 {
  margin: 0;
  color: var(--text);
  font-size: 13px;
  font-weight: 650;
}

.workspace-organizer__heading span,
.workspace-organizer__group h3 span {
  color: var(--text-faint);
  font-size: 11px;
  font-weight: 500;
}

.workspace-organizer__rows,
.workspace-organizer__groups {
  display: flex;
  gap: 6px;
  margin-top: 6px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: thin;
}

.workspace-organizer__row {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  max-width: 220px;
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  background: var(--bg-subtle);
}

.workspace-organizer__main,
.workspace-organizer__remove,
.workspace-organizer__repo {
  border: 0;
  background: transparent;
  color: var(--text);
  cursor: pointer;
}

.workspace-organizer__main {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 6px 4px 6px 8px;
}

.workspace-organizer__main span,
.workspace-organizer__repo {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-organizer__main small {
  color: var(--text-faint);
  font-size: 10px;
}

.workspace-organizer__star {
  flex: 0 0 auto;
  fill: var(--warn);
  color: var(--warn);
}

.workspace-organizer__remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  color: var(--text-faint);
  border-radius: 4px;
}

.workspace-organizer__main:hover,
.workspace-organizer__remove:hover,
.workspace-organizer__repo:hover {
  background: var(--bg-hover);
}

.workspace-organizer__groups {
  align-items: stretch;
}

.workspace-organizer__group {
  flex: 0 0 min(190px, 40vw);
  min-width: 0;
  padding: 6px;
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  background: var(--bg-subtle);
}

.workspace-organizer__group h3 {
  margin: 0 4px 4px;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-organizer__repo {
  display: block;
  width: 100%;
  padding: 4px 6px;
  border-radius: 4px;
  text-align: left;
  font-size: 12px;
}

.workspace-organizer__empty,
.workspace-organizer__group-empty,
.workspace-organizer__error {
  margin: 6px 0 0;
  color: var(--text-faint);
  font-size: 11px;
}

.workspace-organizer__error {
  color: var(--err);
}

.workspace-organizer__group-empty {
  margin: 4px;
}

@media (max-width: 820px) {
  .workspace-organizer {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
