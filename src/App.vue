<script setup lang="ts">
import { ConfigProvider } from "ant-design-vue";
import ImageEditor from "./views/ImageEditor.vue";
</script>

<template>
  <ConfigProvider :theme="{ token: { colorPrimary: '#6558d9', borderRadius: 10, colorText: '#24263b' } }">
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

        <a-tag color="success">FREE · 永久免费</a-tag>
      </a-layout-header>

      <a-layout-content class="app-content min-h-0 flex-1 overflow-auto bg-background p-3 sm:p-6">
        <div class="mx-auto max-w-7xl">
          <ImageEditor />
        </div>
      </a-layout-content>

      <a-layout-footer
        class="app-footer shrink-0 border-t border-border bg-card text-center text-xs text-muted-foreground"
      >
        MarkFree © 2026 · 永久免费 · 本地处理
      </a-layout-footer>
    </a-layout>
  </ConfigProvider>
</template>
