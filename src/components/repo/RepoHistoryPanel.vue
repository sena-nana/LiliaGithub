<script setup lang="ts">
import { computed } from "vue";
import type { CommitSummary } from "../../services/workspace";
import { buildCommitGraph, type CommitGraphLine } from "../../utils/commitGraph";
import { formatCompactRepoTime, formatRepoTime } from "../../utils/repoDisplay";

const props = defineProps<{
  commits: readonly CommitSummary[];
  commitMetaTitle: (commit: CommitSummary) => string;
}>();

defineEmits<{
  openCommit: [commit: CommitSummary];
}>();

const graphRows = computed(() => buildCommitGraph(props.commits));
const graphViewportWidth = computed(() => graphWidth(graphRows.value[0]?.maxLaneCount ?? 1));

const graphLaneWidth = 14;
const graphPaddingX = 8;
const graphHeight = 28;
const graphCenterY = graphHeight / 2;

function graphWidth(laneCount: number) {
  return laneCount * graphLaneWidth + graphPaddingX * 2;
}

function laneX(index: number) {
  return graphPaddingX + index * graphLaneWidth + graphLaneWidth / 2;
}

type ConnectorEdge = "top" | "center" | "bottom";

function edgeY(edge: ConnectorEdge) {
  if (edge === "top") return 0;
  if (edge === "bottom") return graphHeight;
  return graphCenterY;
}

function connectorPath(sourceLane: number, targetLane: number, sourceEdge: ConnectorEdge, targetEdge: ConnectorEdge) {
  const sourceX = laneX(sourceLane);
  const targetX = laneX(targetLane);
  const sourceY = edgeY(sourceEdge);
  const targetY = edgeY(targetEdge);
  const direction = targetY >= sourceY ? 1 : -1;
  const verticalGap = Math.max(7, Math.abs(targetY - sourceY) * 0.62);
  return `M ${sourceX} ${sourceY} C ${sourceX} ${sourceY + verticalGap * direction}, ${targetX} ${targetY - verticalGap * direction}, ${targetX} ${targetY}`;
}

function lineTargets(line: CommitGraphLine) {
  return line.targetLanes.length ? line.targetLanes : [line.lane];
}

function linePath(line: CommitGraphLine, targetLane: number) {
  if (line.role === "top") {
    return connectorPath(targetLane, line.lane, "top", "center");
  }
  return connectorPath(line.lane, targetLane, "center", "bottom");
}

function lineKey(line: CommitGraphLine, targetLane: number) {
  return `${line.id}:${targetLane}`;
}
</script>

<template>
  <section class="repo-panel repo-panel--history project-section">
    <p v-if="!commits.length" class="muted repo-empty">没有提交历史。</p>
    <div
      v-else
      class="history-list"
      aria-label="提交历史密集列表"
      :style="{ '--history-graph-width': `${graphViewportWidth}px` }"
    >
      <button
        v-for="row in graphRows"
        :key="row.commit.hash"
        type="button"
        class="history-row"
        :title="commitMetaTitle(row.commit)"
        @click="$emit('openCommit', row.commit)"
      >
        <span class="history-graph" aria-label="提交图谱">
          <svg
            class="history-graph__svg"
            :width="graphWidth(row.maxLaneCount)"
            :height="graphHeight"
            :viewBox="`0 0 ${graphWidth(row.maxLaneCount)} ${graphHeight}`"
            aria-hidden="true"
          >
            <template v-for="line in row.topLine" :key="line.id">
              <path
                v-for="targetLane in lineTargets(line)"
                v-show="!line.hidden"
                :key="lineKey(line, targetLane)"
                class="history-graph__connector"
                :d="linePath(line, targetLane)"
                :stroke="line.color"
              />
            </template>
            <template v-for="line in row.bottomLine" :key="line.id">
              <path
                v-for="targetLane in lineTargets(line)"
                v-show="!line.hidden"
                :key="lineKey(line, targetLane)"
                class="history-graph__connector"
                :d="linePath(line, targetLane)"
                :stroke="line.color"
              />
            </template>
            <circle
              class="history-graph__node"
              :class="`history-graph__node--${row.node.iconType}`"
              :data-icon-type="row.node.iconType"
              :cx="laneX(row.node.lane)"
              :cy="graphCenterY"
              r="5"
              :stroke="row.node.color"
            />
          </svg>
        </span>
        <span class="history-row__body">
          <span class="history-row__main">
            <strong>{{ row.commit.subject }}</strong>
            <span class="history-row__refs" v-if="row.commit.refs.length">
              <span v-for="ref in row.commit.refs.slice(0, 3)" :key="ref">{{ ref }}</span>
            </span>
          </span>
        </span>
        <span class="history-row__tail">
          <span class="history-row__author">{{ row.commit.author }}</span>
          <time class="history-row__time" :datetime="new Date(row.commit.timestamp * 1000).toISOString()">
            {{ formatCompactRepoTime(row.commit.timestamp) }}
          </time>
        </span>
        <span class="history-popover" role="tooltip">
          <strong>{{ row.commit.subject }}</strong>
          <span>{{ row.commit.hash }}</span>
          <span>{{ row.commit.authorEmail ? `${row.commit.author} <${row.commit.authorEmail}>` : row.commit.author }}</span>
          <span>{{ formatRepoTime(row.commit.timestamp) }}</span>
          <span>{{ row.commit.parents.length ? `父提交 ${row.commit.parents.join(", ")}` : "根提交" }}</span>
          <span v-if="row.commit.refs.length">引用 {{ row.commit.refs.join(", ") }}</span>
        </span>
      </button>
    </div>
  </section>
</template>
