<script setup lang="ts">
import { ConfigProvider } from "ant-design-vue";
import ImageEditor from "./views/ImageEditor.vue";
</script>

<template>
  <ConfigProvider :auto-insert-space-in-button="false" :theme="{ token: { colorPrimary: '#6558d9', borderRadius: 10, colorText: '#24263b' } }">
    <a-layout class="h-dvh w-full">
      <a-layout-header
        class="app-header flex shrink-0 items-center justify-between border-b border-border !bg-card"
      >
        <div class="flex items-center gap-2">
          <div
            class="brand-mark flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-xl text-primary-foreground"
          >
            M
          </div>
          <span class="brand-name text-xl font-bold">MarkFree</span>
        </div>

        <div class="header-meta">
          <span class="local-badge"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/></svg>图片仅在本地处理</span>
          <span class="free-badge">永久免费</span>
        </div>
      </a-layout-header>

      <a-layout-content class="app-content min-h-0 flex-1 bg-background">
        <div class="app-workspace">
          <ImageEditor />
        </div>
      </a-layout-content>
    </a-layout>
  </ConfigProvider>
</template>
