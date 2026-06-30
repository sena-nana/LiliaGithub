<script setup lang="ts">
import { Blend, Circle, Moon, Sun } from "@lucide/vue";
import {
  CORNER_RADIUS_MAX,
  CORNER_RADIUS_MIN,
  useCornerStyle,
} from "@lilia/ui";
import { useTheme } from "@lilia/ui";

const { theme, setTheme } = useTheme();
const { cornerStyle, cornerRadius, setCornerRadius, setCornerStyle } = useCornerStyle();

function onCornerRadiusInput(event: Event) {
  setCornerRadius(Number((event.target as HTMLInputElement).value));
}
</script>

<template>
  <div class="card">
    <h2>外观</h2>
    <div class="settings-row">
      <div class="settings-row__label">
        <div>主题</div>
        <div class="settings-row__hint">选择应用配色，立即生效并记忆到本地。</div>
      </div>
      <div class="segmented" role="radiogroup" aria-label="主题">
        <button
          type="button"
          role="radio"
          data-agent-id="settings.appearance.theme.dark"
          :aria-checked="theme === 'dark'"
          :class="{ 'is-active': theme === 'dark' }"
          @click="setTheme('dark')"
        >
          <Moon :size="14" aria-hidden="true" />
          暗色
        </button>
        <button
          type="button"
          role="radio"
          data-agent-id="settings.appearance.theme.light"
          :aria-checked="theme === 'light'"
          :class="{ 'is-active': theme === 'light' }"
          @click="setTheme('light')"
        >
          <Sun :size="14" aria-hidden="true" />
          浅色
        </button>
      </div>
    </div>
    <div class="settings-row">
      <div class="settings-row__label">
        <div>语言</div>
        <div class="settings-row__hint">模板默认使用简体中文界面文案。</div>
      </div>
      <span class="muted">简体中文</span>
    </div>
    <div class="settings-row">
      <div class="settings-row__label">
        <div>圆角</div>
        <div class="settings-row__hint">切换界面圆角曲线。</div>
      </div>
      <div class="ui-segmented" role="radiogroup" aria-label="圆角">
        <button
          type="button"
          role="radio"
          data-agent-id="settings.appearance.corner.smooth"
          :aria-checked="cornerStyle === 'smooth'"
          :class="{ 'is-active': cornerStyle === 'smooth' }"
          @click="setCornerStyle('smooth')"
        >
          <Blend :size="14" aria-hidden="true" />
          平滑
        </button>
        <button
          type="button"
          role="radio"
          data-agent-id="settings.appearance.corner.round"
          :aria-checked="cornerStyle === 'round'"
          :class="{ 'is-active': cornerStyle === 'round' }"
          @click="setCornerStyle('round')"
        >
          <Circle :size="14" aria-hidden="true" />
          普通
        </button>
      </div>
    </div>
    <div class="settings-row">
      <div class="settings-row__label">
        <div>圆角半径</div>
        <div class="settings-row__hint">控制主要控件和卡片的半径。</div>
      </div>
      <div class="settings-row__control settings-row__radius-control">
        <input
          type="range"
          :min="CORNER_RADIUS_MIN"
          :max="CORNER_RADIUS_MAX"
          step="1"
          :value="cornerRadius"
          aria-label="圆角半径"
          data-agent-id="settings.appearance.corner.radius"
          @input="onCornerRadiusInput"
        />
        <output>{{ cornerRadius }}px</output>
      </div>
    </div>
  </div>
</template>
