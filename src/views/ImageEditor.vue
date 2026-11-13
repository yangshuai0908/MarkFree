<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, nextTick } from "vue";
import { message } from "ant-design-vue";
import JSZip from "jszip";

const fileInput = ref<HTMLInputElement>();
const logoInput = ref<HTMLInputElement>();
const canvasRef = ref<HTMLCanvasElement>();

// ── Batch image list ──
interface ImageItem {
  id: number;
  url: string;
  img: HTMLImageElement;
  name: string;
  watermark?: WatermarkSettings;
}

interface WatermarkSettings {
  watermarkType: "text" | "logo";
  watermarkText: string;
  watermarkColor: string;
  fontSize: number;
  logoUrl: string;
  logoImage: HTMLImageElement | null;
  logoScale: number;
  opacity: number;
  rotation: number;
  repeat: boolean;
  position: string;
  offsetX: number;
  offsetY: number;
}

let nextId = 0;
const images = ref<ImageItem[]>([]);
const activeIndex = ref(0);
const activeItem = computed(() => images.value[activeIndex.value] ?? null);

// Images inherit the shared settings until an independent snapshot is created.
const sharedSettings = ref<WatermarkSettings>({
  watermarkType: "text",
  watermarkText: "仅供个人使用 · MarkFree",
  watermarkColor: "#ffffff",
  fontSize: 48,
  logoUrl: "",
  logoImage: null,
  logoScale: 20,
  opacity: 35,
  rotation: -30,
  repeat: true,
  position: "right-bottom",
  offsetX: 0.8,
  offsetY: 0.85,
});

function getWatermark(item: ImageItem) {
  return item.watermark ?? sharedSettings.value;
}

const currentSettings = computed(() => activeItem.value ? getWatermark(activeItem.value) : sharedSettings.value);

// Keep the existing controls bound directly to the selected settings, without copying form state.
function setting<K extends keyof WatermarkSettings>(key: K) {
  return computed({
    get: () => currentSettings.value[key],
    set: (value: WatermarkSettings[K]) => { currentSettings.value[key] = value; },
  });
}

const watermarkType = setting("watermarkType");
const watermarkText = setting("watermarkText");
const watermarkColor = setting("watermarkColor");
const fontSize = setting("fontSize");
const logoUrl = setting("logoUrl");
const logoImage = setting("logoImage");
const logoScale = setting("logoScale");
const opacity = setting("opacity");
const rotation = setting("rotation");
const repeat = setting("repeat");
const offsetX = setting("offsetX");
const offsetY = setting("offsetY");
const position = computed({
  get: () => currentSettings.value.position,
  set: (value: string) => {
    const settings = currentSettings.value;
    settings.position = value;
    settings.offsetX = value === "left-top" ? 0.15 : value === "center" ? 0.5 : 0.8;
    settings.offsetY = value === "left-top" ? 0.1 : value === "center" ? 0.5 : 0.85;
  },
});
const customWatermark = computed({
  get: () => !!activeItem.value?.watermark,
  set: (enabled: boolean) => {
    const item = activeItem.value;
    if (!item || batchProcessing.value) return;
    if (enabled && !item.watermark) item.watermark = { ...getWatermark(item) };
    if (!enabled) delete item.watermark;
    releaseUnusedLogos();
  },
});

const logoUrls = new Set<string>();
let disposed = false;

function releaseUnusedLogos() {
  const used = new Set([sharedSettings.value.logoUrl, ...images.value.map(item => item.watermark?.logoUrl)]);
  for (const url of logoUrls) {
    if (!used.has(url)) {
      URL.revokeObjectURL(url);
      logoUrls.delete(url);
    }
  }
}

const isDragging = ref(false);
const uploadDragDepth = ref(0);
const touchDragEnabled = ref(false);

let dragStartX = 0;
let dragStartY = 0;
let startOffsetX = 0;
let startOffsetY = 0;

// Export state covers image rendering and ZIP compression separately.
const exportStage = ref<"idle" | "rendering" | "packing" | "done" | "error">("idle");
const exportKind = ref<"single" | "zip">("zip");
const batchProcessing = computed(() => exportStage.value === "rendering" || exportStage.value === "packing");
const batchProgress = ref(0);
const batchTotal = ref(0);
const packingProgress = ref(0);
const exportLabel = computed(() => {
  if (exportStage.value === "rendering") return `正在处理图片 ${batchProgress.value}/${batchTotal.value}`;
  if (exportStage.value === "packing") return `正在打包 ZIP · ${packingProgress.value}%`;
  if (exportStage.value === "done") return exportKind.value === "zip"
    ? `${batchTotal.value} 张图片已打包，已发起下载`
    : "图片已生成，已发起下载";
  return "导出失败，请重试";
});

const hasImages = computed(() => images.value.length > 0);
const hasLogo = computed(() => !!logoImage.value);

// ── File handling ──
function selectImage() {
  if (batchProcessing.value) return;
  fileInput.value?.click();
}

function selectLogo() {
  if (batchProcessing.value) return;
  logoInput.value?.click();
}

function loadImageFromFile(file: File): Promise<ImageItem> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("不是图片文件"));
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      reject(new Error("图片不能超过 50MB"));
      return;
    }

    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      resolve({
        id: nextId++,
        url,
        img,
        name: file.name,
      });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片读取失败"));
    };

    img.src = url;
  });
}

async function handleFileChange(event: Event) {
  const target = event.target as HTMLInputElement;
  const files = Array.from(target.files ?? []);
  target.value = "";

  if (files.length === 0 || batchProcessing.value) return;
  exportStage.value = "idle";

  let loaded = 0;
  for (const file of files) {
    try {
      const item = await loadImageFromFile(file);
      images.value.push(item);
      loaded++;
    } catch (e: any) {
      message.error(`${file.name}: ${e.message}`);
    }
  }

  if (loaded > 0) {
    // Switch to last added image if nothing was selected before
    if (images.value.length === loaded) {
      activeIndex.value = 0;
    }
    await nextTick();
    renderCanvas();
    message.success(`成功导入 ${loaded} 张图片`);
  }
}

function removeImage(index: number) {
  if (batchProcessing.value) return;
  const item = images.value[index];
  URL.revokeObjectURL(item.url);
  images.value.splice(index, 1);
  releaseUnusedLogos();

  if (images.value.length === 0) {
    activeIndex.value = 0;
  } else if (index < activeIndex.value) {
    activeIndex.value--;
  } else if (activeIndex.value >= images.value.length) {
    activeIndex.value = images.value.length - 1;
  }

  nextTick(() => renderCanvas());
}

function clearAllImages() {
  if (batchProcessing.value) return;
  images.value.forEach((item) => URL.revokeObjectURL(item.url));
  images.value = [];
  releaseUnusedLogos();
  activeIndex.value = 0;
  exportStage.value = "idle";
}

function switchImage(index: number) {
  activeIndex.value = index;
  nextTick(() => renderCanvas());
}

function handleLogoChange(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  target.value = "";

  if (!file || batchProcessing.value) return;

  if (!file.type.startsWith("image/")) {
    message.error("请选择图片文件");
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    message.error("Logo 不能超过 10MB");
    return;
  }

  const url = URL.createObjectURL(file);
  const img = new Image();
  const targetSettings = currentSettings.value;

  img.onload = () => {
    if (disposed || (targetSettings !== sharedSettings.value && !images.value.some(item => item.watermark === targetSettings))) {
      URL.revokeObjectURL(url);
      return;
    }
    logoUrls.add(url);
    targetSettings.logoUrl = url;
    targetSettings.logoImage = img;
    releaseUnusedLogos();
    renderCanvas();
    message.success("Logo 导入成功");
  };

  img.onerror = () => {
    URL.revokeObjectURL(url);
    if (!disposed) message.error("Logo 读取失败");
  };

  img.src = url;
}

function removeLogo() {
  if (batchProcessing.value) return;
  logoUrl.value = "";
  logoImage.value = null;
  releaseUnusedLogos();
  renderCanvas();
}

function moveSpotlight(event: PointerEvent) {
  if (event.pointerType !== "mouse") return;
  const area = event.currentTarget as HTMLElement;
  const rect = area.getBoundingClientRect();
  area.style.setProperty("--spot-x", `${event.clientX - rect.left}px`);
  area.style.setProperty("--spot-y", `${event.clientY - rect.top}px`);
}

function handleDrop(event: DragEvent) {
  uploadDragDepth.value = 0;
  if (batchProcessing.value) return;
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length > 0) {
    // Simulate file input
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    if (fileInput.value) {
      fileInput.value.files = dt.files;
      fileInput.value.dispatchEvent(new Event("change"));
    }
  }
}

// ── Render (shared for preview and batch) ──
function applyWatermark(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  settings: WatermarkSettings,
) {
  ctx.save();
  ctx.globalAlpha = settings.opacity / 100;

  if (settings.watermarkType === "text") {
    renderTextWatermark(ctx, canvas, settings);
  } else {
    renderLogoWatermark(ctx, canvas, settings);
  }

  ctx.restore();
}

function renderCanvas() {
  const canvas = canvasRef.value;
  const item = activeItem.value;

  if (!canvas || !item) return;

  canvas.width = item.img.naturalWidth;
  canvas.height = item.img.naturalHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.drawImage(item.img, 0, 0);
  applyWatermark(ctx, canvas, getWatermark(item));
}

function renderTextWatermark(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  settings: WatermarkSettings,
) {
  const { watermarkText, watermarkColor, fontSize, repeat, rotation } = settings;
  if (!watermarkText.trim()) return;

  ctx.font = `bold ${fontSize}px Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = watermarkColor;

  const r = parseInt(watermarkColor.slice(1, 3), 16);
  const g = parseInt(watermarkColor.slice(3, 5), 16);
  const b = parseInt(watermarkColor.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  ctx.strokeStyle =
    luminance > 0.5 ? "rgba(0, 0, 0, 0.35)" : "rgba(255, 255, 255, 0.35)";
  ctx.lineWidth = Math.max(1, fontSize / 16);
  ctx.lineJoin = "round";

  function drawText(text: string) {
    ctx.strokeText(text, 0, 0);
    ctx.fillText(text, 0, 0);
  }

  if (repeat) {
    const textWidth = ctx.measureText(watermarkText).width;
    const gapX = Math.max(textWidth + fontSize * 2, 180);
    const gapY = Math.max(fontSize * 4, 140);

    for (let y = -canvas.height; y < canvas.height * 2; y += gapY) {
      for (let x = -canvas.width; x < canvas.width * 2; x += gapX) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((rotation * Math.PI) / 180);
        drawText(watermarkText);
        ctx.restore();
      }
    }
  } else {
    const pos = getPosition(canvas, settings);
    ctx.translate(pos.x, pos.y);
    ctx.rotate((rotation * Math.PI) / 180);
    drawText(watermarkText);
  }
}

function renderLogoWatermark(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  settings: WatermarkSettings,
) {
  const { logoImage: logo, logoScale, repeat, rotation } = settings;
  if (!logo) return;

  const logoW = canvas.width * (logoScale / 100);
  const logoH = (logo.naturalHeight / logo.naturalWidth) * logoW;

  function drawLogo(x: number, y: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(logo!, -logoW / 2, -logoH / 2, logoW, logoH);
    ctx.restore();
  }

  if (repeat) {
    const gapX = Math.max(logoW * 1.8, 180);
    const gapY = Math.max(logoH * 2.5, 140);

    for (let y = -canvas.height; y < canvas.height * 2; y += gapY) {
      for (let x = -canvas.width; x < canvas.width * 2; x += gapX) {
        drawLogo(x, y);
      }
    }
  } else {
    const pos = getPosition(canvas, settings);
    drawLogo(pos.x, pos.y);
  }
}

function getPosition(canvas: HTMLCanvasElement, settings = currentSettings.value) {
  return {
    x: canvas.width * settings.offsetX,
    y: canvas.height * settings.offsetY,
  };
}

// ── Download ──
function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("导出失败"));
    }, "image/png");
  });
}

async function downloadSingle() {
  const canvas = canvasRef.value;
  const item = activeItem.value;
  if (!canvas || !item || batchProcessing.value) return;
  exportKind.value = "single";
  batchProgress.value = 0;
  batchTotal.value = 1;
  exportStage.value = "rendering";

  try {
    const blob = await canvasToBlob(canvas);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;

    const baseName = item.name.replace(/\.[^/.]+$/, "");
    link.download = `${baseName}_watermark.png`;
    link.click();

    URL.revokeObjectURL(url);
    batchProgress.value = 1;
    exportStage.value = "done";
    message.success("图片已生成，已发起下载");
  } catch (e: any) {
    exportStage.value = "error";
    message.error(`图片导出失败: ${e.message}`);
  }
}

async function downloadBatchZip() {
  if (images.value.length === 0 || batchProcessing.value) return;

  exportKind.value = "zip";
  exportStage.value = "rendering";
  batchProgress.value = 0;
  packingProgress.value = 0;
  const items = images.value.map(item => ({ ...item, watermark: { ...getWatermark(item) } }));
  batchTotal.value = items.length;

  try {
    const zip = new JSZip();
    const offscreen = document.createElement("canvas");
    const ctx = offscreen.getContext("2d");
    if (!ctx) throw new Error("无法创建画布");

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      offscreen.width = item.img.naturalWidth;
      offscreen.height = item.img.naturalHeight;

      ctx.clearRect(0, 0, offscreen.width, offscreen.height);
      ctx.drawImage(item.img, 0, 0);
      applyWatermark(ctx, offscreen, item.watermark);

      const blob = await canvasToBlob(offscreen);
      const baseName = item.name.replace(/\.[^/.]+$/, "");
      let fileName = `${baseName}_watermark.png`;
      let suffix = 2;
      while (zip.file(fileName)) {
        fileName = `${baseName}_watermark_${suffix++}.png`;
      }
      zip.file(fileName, blob);

      batchProgress.value = i + 1;

      // Yield to keep UI responsive
      await new Promise((r) => setTimeout(r, 0));
    }

    exportStage.value = "packing";
    const zipBlob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    }, ({ percent }) => {
      packingProgress.value = Math.min(99, Math.floor(percent));
    });

    const url = URL.createObjectURL(zipBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `MarkFree_batch_${Date.now()}.zip`;
    link.click();

    URL.revokeObjectURL(url);
    packingProgress.value = 100;
    exportStage.value = "done";
    message.success(`已打包 ${items.length} 张图片，已发起下载`);
  } catch (e: any) {
    exportStage.value = "error";
    message.error(`批量处理失败: ${e.message}`);
  }
}

// ── Pointer drag ──
function handlePointerDown(event: PointerEvent) {
  if (batchProcessing.value || !activeItem.value || repeat.value || event.isPrimary === false || event.button > 0) return;
  if (event.pointerType === "touch" && !touchDragEnabled.value) return;

  isDragging.value = true;
  dragStartX = event.clientX;
  dragStartY = event.clientY;
  startOffsetX = offsetX.value;
  startOffsetY = offsetY.value;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function handlePointerMove(event: PointerEvent) {
  if (!isDragging.value || !activeItem.value || !canvasRef.value || event.isPrimary === false) return;

  const rect = canvasRef.value.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  offsetX.value = Math.max(
    0,
    Math.min(1, startOffsetX + (event.clientX - dragStartX) / rect.width),
  );

  offsetY.value = Math.max(
    0,
    Math.min(1, startOffsetY + (event.clientY - dragStartY) / rect.height),
  );

  renderCanvas();
}

function handlePointerUp() {
  isDragging.value = false;
}

watch(repeat, () => {
  touchDragEnabled.value = false;
  handlePointerUp();
});

watch(activeItem, () => {
  touchDragEnabled.value = false;
  handlePointerUp();
});

watch(currentSettings, () => {
  if (!batchProcessing.value) exportStage.value = "idle";
  renderCanvas();
}, { deep: true, flush: "post" });

// The empty-state transition mounts the canvas after the file handler's nextTick.
watch(canvasRef, renderCanvas, { flush: "post" });

onBeforeUnmount(() => {
  disposed = true;
  images.value.forEach((item) => URL.revokeObjectURL(item.url));
  logoUrls.forEach(url => URL.revokeObjectURL(url));
});
</script>

<template>
  <div class="image-editor space-y-4 lg:space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold text-foreground">图片水印</h1>
        <p class="mt-1 text-sm text-muted-foreground">
          上传图片，自定义水印，保护你的作品版权。支持批量处理。
        </p>
      </div>

      <div class="export-actions flex gap-2" :class="{ 'single-export': images.length <= 1 }" role="group" aria-label="导出图片">
        <a-button :type="images.length > 1 ? 'default' : 'primary'" :disabled="!activeItem || !canvasRef || batchProcessing" @click="downloadSingle">
          {{ images.length > 1 ? '导出当前' : '导出' }}
        </a-button>
        <a-button
          v-if="images.length > 1"
          type="primary"
          :disabled="!hasImages || batchProcessing"
          :loading="batchProcessing"
          @click="downloadBatchZip"
        >
          {{ batchProcessing ? (exportStage === 'packing' ? '正在打包 ZIP…' : `处理中 ${batchProgress}/${batchTotal}`) : `批量下载 ZIP${images.length ? ` (${images.length})` : ''}` }}
        </a-button>
      </div>
    </div>

    <input
      ref="fileInput"
      type="file"
      accept="image/png,image/jpeg,image/webp"
      class="hidden"
      multiple
      @change="handleFileChange"
    />
    <input
      ref="logoInput"
      type="file"
      accept="image/png,image/jpeg,image/webp,image/svg+xml"
      class="hidden"
      @change="handleLogoChange"
    />

    <Transition name="content">
      <div v-if="exportStage !== 'idle'" class="export-status" :class="`export-status--${exportStage}`" role="status" aria-live="polite" aria-atomic="true">
        <svg :key="exportStage" class="status-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <circle v-if="batchProcessing" class="status-spinner" cx="12" cy="12" r="8" />
          <path v-else-if="exportStage === 'done'" class="status-check" d="m5 12 4 4L19 6" />
          <path v-else d="m7 7 10 10M17 7 7 17" />
        </svg>
        <div class="min-w-0 flex-1">
          <span class="text-sm font-medium">{{ exportLabel }}</span>
          <a-progress
            v-if="batchProcessing"
            :key="exportStage"
            :percent="exportStage === 'packing' ? packingProgress : Math.round((batchProgress / batchTotal) * 100)"
            :show-info="false"
            status="active"
            size="small"
          />
        </div>
      </div>
    </Transition>

    <a-row :gutter="[16, 16]">
      <a-col :xs="24" :lg="16">
        <a-card id="image-preview" class="editor-card h-full">
          <template #title>
            <div class="flex items-center justify-between">
              <span>图片预览</span>
              <a href="#watermark-settings" class="section-link lg:hidden">调整水印 ↓</a>
              <span v-if="hasImages" class="text-xs font-normal text-muted-foreground">
                {{ activeIndex + 1 }} / {{ images.length }}
              </span>
            </div>
          </template>

          <!-- Upload area -->
          <Transition name="content" mode="out-in">
            <div
              v-if="!hasImages"
              key="upload"
              class="upload-area flex min-h-[280px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed p-5 text-center lg:min-h-[420px]"
              :class="{ 'is-file-dragging': uploadDragDepth > 0 }"
              role="group"
              aria-label="导入图片"
              @click="selectImage"
              @pointermove="moveSpotlight"
              @dragenter.prevent="uploadDragDepth++"
              @dragover.prevent
              @dragleave.prevent="uploadDragDepth = Math.max(0, uploadDragDepth - 1)"
              @drop.prevent="handleDrop"
            >
              <div class="upload-art" aria-hidden="true">
                <div class="upload-art-back"></div>
                <div class="upload-art-front">
                  <svg width="42" height="42" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="5" y="5" width="30" height="30" rx="6" />
                    <circle cx="15" cy="15" r="3" />
                    <path d="m6 29 9-9 6 6 6-9 8 12" />
                  </svg>
                </div>
                <span class="upload-art-plus">+</span>
              </div>
              <h3 class="text-lg font-semibold text-foreground">
                {{ uploadDragDepth > 0 ? '松开鼠标，导入图片' : '上传图片开始编辑' }}
              </h3>
              <p class="mt-2 text-sm text-muted-foreground">
                拖拽图片到这里，或点击选择 · 支持批量处理
              </p>
              <a-button type="primary" size="large" class="upload-button mt-5">选择图片 <span aria-hidden="true">↗</span></a-button>
              <p class="upload-formats mt-4 text-xs text-muted-foreground">JPG / PNG / WebP · 单张最大 50MB</p>
              <span class="upload-privacy mt-5 text-xs text-muted-foreground">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/></svg>
                本地处理，图片不会离开你的设备
              </span>
            </div>

            <!-- Preview + thumbnails -->
            <div v-else key="preview" class="space-y-4">
              <div class="flex min-w-0 flex-col gap-3 sm:flex-row sm:justify-between">
                <span class="min-w-0 text-sm text-muted-foreground">
                  {{ activeItem?.img.naturalWidth }} × {{ activeItem?.img.naturalHeight }}
                  <span class="block truncate text-xs" :title="activeItem?.name">{{ activeItem?.name }}</span>
                </span>
                <div class="flex shrink-0 gap-2">
                  <a-button size="small" :disabled="batchProcessing" @click="selectImage">添加图片</a-button>
                  <a-button size="small" danger :disabled="batchProcessing" @click="clearAllImages">清空全部</a-button>
                </div>
              </div>

              <div
                class="preview-stage flex min-h-[180px] items-center justify-center overflow-hidden rounded-lg bg-muted p-2 lg:min-h-[300px] lg:p-3"
              >
                <canvas
                  ref="canvasRef"
                  class="preview-canvas max-h-[600px] max-w-full object-contain"
                  :class="{ 'cursor-crosshair': !repeat }"
                  :style="{ touchAction: !repeat && touchDragEnabled ? 'none' : 'pan-y pinch-zoom' }"
                  @pointerdown="handlePointerDown"
                  @pointermove="handlePointerMove"
                  @pointerup="handlePointerUp"
                  @pointercancel="handlePointerUp"
                  @lostpointercapture="handlePointerUp"
                />
              </div>

              <div class="flex flex-wrap items-center justify-between gap-2">
                <p class="!mb-0 text-xs text-muted-foreground">
                  {{ repeat ? "当前为平铺水印模式" : touchDragEnabled ? "拖动图片调整水印，完成后关闭移动" : "鼠标可直接拖动，触屏请先开启移动" }}
                </p>
                <a-button
                  v-if="!repeat"
                  class="touch-drag-toggle"
                  :type="touchDragEnabled ? 'primary' : 'default'"
                  :aria-pressed="touchDragEnabled"
                  @click="touchDragEnabled = !touchDragEnabled"
                >
                  {{ touchDragEnabled ? '完成移动' : '移动水印' }}
                </a-button>
              </div>

              <!-- Thumbnail strip -->
              <div v-if="images.length > 1" class="thumbnail-strip flex gap-3 overflow-x-auto rounded-lg border border-border bg-muted p-2" aria-label="已导入的图片">
                <div
                  v-for="(item, idx) in images"
                  :key="item.id"
                  class="relative shrink-0"
                >
                  <button
                    type="button"
                    class="block rounded-md"
                    :aria-label="`预览第 ${idx + 1} 张图片：${item.name}（${item.watermark ? '单独水印' : '统一水印'}）`"
                    :aria-pressed="idx === activeIndex"
                    @click="switchImage(idx)"
                  >
                    <img
                      :src="item.url"
                      class="h-16 w-16 rounded-md object-cover transition"
                      :class="idx === activeIndex ? 'ring-2 ring-primary' : 'opacity-60 hover:opacity-100'"
                      :alt="item.name"
                    />
                  </button>
                  <span v-if="item.watermark" class="pointer-events-none absolute right-0 top-11 rounded-br-md rounded-tl-md bg-primary px-1 text-[10px] text-primary-foreground">单独</span>
                  <button
                    type="button"
                    class="thumbnail-remove absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-xs text-destructive-foreground"
                    :aria-label="`删除第 ${idx + 1} 张图片：${item.name}`"
                    :disabled="batchProcessing"
                    @click.stop="removeImage(idx)"
                  >
                    ×
                  </button>
                  <span class="pointer-events-none absolute left-0 top-11 w-6 rounded-tr-md bg-black/50 px-1 text-center text-[10px] text-white">
                    {{ idx + 1 }}
                  </span>
                </div>
              </div>
            </div>
          </Transition>
        </a-card>
      </a-col>

      <a-col :xs="24" :lg="8">
        <a-card id="watermark-settings" class="editor-card h-full">
          <template #title>
            <div class="flex items-center justify-between gap-2">
              <span>水印设置</span>
              <a href="#image-preview" class="section-link lg:hidden">查看预览 ↑</a>
            </div>
          </template>
          <fieldset class="settings-fields space-y-5" :disabled="batchProcessing">
            <div v-if="activeItem" class="rounded-lg border border-border bg-muted p-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <a-checkbox v-model:checked="customWatermark" :disabled="batchProcessing">单独设置当前图片</a-checkbox>
                <a-button v-if="customWatermark" size="small" :disabled="batchProcessing" @click="customWatermark = false">恢复统一设置</a-button>
              </div>
              <p class="!mb-0 mt-2 text-xs text-muted-foreground" aria-live="polite">
                {{ customWatermark ? '仅修改当前图片，其他图片不受影响。' : '当前使用统一设置，修改会应用到所有未单独设置的图片。' }}
              </p>
              <p v-if="customWatermark" class="!mb-0 mt-1 truncate text-xs text-primary" :title="activeItem.name">{{ activeItem.name }}</p>
            </div>
            <!-- Watermark type toggle -->
            <div>
              <label class="mb-2 block text-sm font-medium text-foreground">水印类型</label>
              <div class="watermark-type" :class="{ 'is-logo': watermarkType === 'logo' }">
                <span class="type-indicator" aria-hidden="true"></span>
                <a-radio-group
                  v-model:value="watermarkType"
                  :disabled="batchProcessing"
                  aria-label="水印类型"
                  class="w-full"
                >
                  <a-radio-button value="text" class="!w-1/2 !text-center">文字水印</a-radio-button>
                  <a-radio-button value="logo" class="!w-1/2 !text-center">Logo 水印</a-radio-button>
                </a-radio-group>
              </div>
            </div>

            <Transition name="settings" mode="out-in">
              <div :key="watermarkType" class="space-y-5">
                <!-- Text watermark settings -->
                <template v-if="watermarkType === 'text'">
                  <div>
                    <label class="mb-2 block text-sm font-medium text-foreground">水印文字</label>
                    <a-textarea
                      v-model:value="watermarkText"
                      :disabled="batchProcessing"
                      aria-label="水印文字"
                      :rows="3"
                      placeholder="请输入水印内容"
                      :maxlength="100"
                      show-count
                    />
                  </div>

                  <div>
                    <label class="mb-2 block text-sm font-medium text-foreground">水印颜色</label>
                    <div class="flex flex-wrap items-center gap-3">
                      <input
                        type="color"
                        v-model="watermarkColor"
                        :disabled="batchProcessing"
                        aria-label="自定义水印颜色"
                        class="h-11 w-12 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
                      />
                      <span class="text-sm text-muted-foreground">{{ watermarkColor }}</span>
                      <div class="color-presets flex flex-wrap gap-2">
                        <button
                          v-for="c in ['#ffffff', '#000000', '#ff4d4f', '#1677ff', '#52c41a', '#faad14']"
                          :key="c"
                          type="button"
                          :aria-label="`水印颜色 ${c}`"
                          :aria-pressed="watermarkColor === c"
                          class="h-11 w-11 rounded-full border-2 transition-transform hover:scale-110 lg:h-6 lg:w-6"
                          :class="watermarkColor === c ? 'border-primary scale-110' : 'border-border'"
                          :style="{ backgroundColor: c }"
                          @click="watermarkColor = c"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <div class="mb-2 flex justify-between">
                      <label class="text-sm font-medium text-foreground">字体大小</label>
                      <span class="text-sm text-primary">{{ fontSize }}px</span>
                    </div>
                    <a-slider v-model:value="fontSize" :disabled="batchProcessing" :min="12" :max="120" aria-label-for-handle="字体大小" />
                  </div>
                </template>

                <!-- Logo watermark settings -->
                <template v-if="watermarkType === 'logo'">
                  <div>
                    <label class="mb-2 block text-sm font-medium text-foreground">Logo 图片</label>
                    <button
                      v-if="!hasLogo"
                      type="button"
                      class="flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted p-6 transition hover:border-primary hover:bg-accent"
                      @click="selectLogo"
                    >
                      <svg class="text-primary" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="9" cy="9" r="2"/><path d="m3 17 6-5 4 4 3-5 5 6"/></svg>
                      <span class="text-sm text-muted-foreground">点击上传 Logo</span>
                      <span class="text-xs text-muted-foreground">PNG / JPG / WebP / SVG · 最大 10MB</span>
                    </button>
                    <div
                      v-else
                      class="flex items-center gap-3 rounded-lg border border-border bg-muted p-3"
                    >
                      <img :src="logoUrl" class="h-12 w-12 rounded object-contain" alt="Logo" />
                      <div class="min-w-0 flex-1">
                        <p class="truncate text-sm text-foreground">
                          {{ logoImage?.naturalWidth }} × {{ logoImage?.naturalHeight }}
                        </p>
                        <p class="text-xs text-muted-foreground">已上传</p>
                      </div>
                      <div class="flex shrink-0 flex-wrap gap-1">
                        <a-button size="small" @click="selectLogo">更换</a-button>
                        <a-button size="small" danger @click="removeLogo">删除</a-button>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div class="mb-2 flex justify-between">
                      <label class="text-sm font-medium text-foreground">Logo 大小</label>
                      <span class="text-sm text-primary">{{ logoScale }}%</span>
                    </div>
                    <a-slider v-model:value="logoScale" :disabled="batchProcessing" :min="3" :max="60" aria-label-for-handle="Logo 大小" />
                  </div>
                </template>
              </div>
            </Transition>

            <!-- Common settings -->
            <div>
              <div class="mb-2 flex justify-between">
                <label class="text-sm font-medium text-foreground">透明度</label>
                <span class="text-sm text-primary">{{ opacity }}%</span>
              </div>
              <a-slider v-model:value="opacity" :disabled="batchProcessing" :min="5" :max="100" aria-label-for-handle="透明度" />
            </div>

            <div>
              <div class="mb-2 flex justify-between">
                <label class="text-sm font-medium text-foreground">旋转角度</label>
                <span class="text-sm text-primary">{{ rotation }}°</span>
              </div>
              <a-slider v-model:value="rotation" :disabled="batchProcessing" :min="-90" :max="90" aria-label-for-handle="旋转角度" />
            </div>

            <a-divider />

            <a-checkbox v-model:checked="repeat" :disabled="batchProcessing"> 开启全屏平铺水印 </a-checkbox>

            <Transition name="settings">
              <div v-if="!repeat">
                <label class="mb-2 block text-sm font-medium text-foreground">水印位置</label>
                <a-select
                  v-model:value="position"
                  :disabled="batchProcessing"
                  aria-label="水印位置"
                  class="w-full"
                  :options="[
                    { label: '左上角', value: 'left-top' },
                    { label: '居中', value: 'center' },
                    { label: '右下角', value: 'right-bottom' },
                  ]"
                />
              </div>
            </Transition>

            <a-divider />

            <a-button
              class="settings-download"
              type="primary"
              block
              size="large"
              :disabled="!hasImages || (images.length === 1 && !canvasRef) || batchProcessing"
              :loading="batchProcessing"
              @click="images.length > 1 ? downloadBatchZip() : downloadSingle()"
            >
              {{ batchProcessing ? (exportStage === 'packing' ? '正在打包 ZIP…' : `处理中 ${batchProgress}/${batchTotal}`) : images.length > 1 ? `批量下载 ZIP (${images.length} 张)` : '导出' }}
            </a-button>

            <p class="text-center text-xs text-muted-foreground">
              图片在浏览器本地处理，不会上传服务器
            </p>
          </fieldset>
        </a-card>
      </a-col>
    </a-row>
  </div>
</template>

<style scoped>
.editor-card {
  border-color: var(--border);
  box-shadow: 0 4px 24px #24263b03;
}

.settings-fields {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.upload-area {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  border-color: #d9d5ed;
  background: linear-gradient(155deg, #faf9ff, #f6f7fb 70%);
  transition: border-color 200ms, box-shadow 200ms;
}

.upload-area::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background: radial-gradient(350px circle at var(--spot-x, 50%) var(--spot-y, 45%), #c3b5ff55, transparent 80%);
  opacity: 0;
  transition: opacity 250ms;
}

.upload-area:focus-within,
.upload-area.is-file-dragging {
  border-color: var(--primary);
  box-shadow: inset 0 0 0 1px var(--primary);
}

.upload-area:focus-within::before,
.upload-area.is-file-dragging::before {
  opacity: 1;
}

.upload-art {
  position: relative;
  width: 94px;
  height: 86px;
  margin-bottom: 24px;
  pointer-events: none;
  transition: transform 300ms cubic-bezier(.2, .8, .2, 1);
}

.upload-art-back,
.upload-art-front {
  position: absolute;
  display: grid;
  place-items: center;
  width: 70px;
  height: 72px;
  border: 1px solid #dcd5fa;
  border-radius: 15px;
}

.upload-art-back {
  top: 4px;
  left: 3px;
  background: #eae5ff;
  transform: rotate(-13deg);
}

.upload-art-front {
  top: 8px;
  left: 17px;
  color: var(--primary);
  background: #fff;
  transform: rotate(6deg);
  box-shadow: 0 8px 20px #6558d912;
}

.upload-art-plus {
  position: absolute;
  right: 0;
  bottom: 0;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 3px solid #f8f7fd;
  border-radius: 50%;
  color: white;
  background: var(--primary);
  font-size: 21px;
  line-height: 1;
}

.upload-area.is-file-dragging .upload-art {
  transform: translateY(-6px) rotate(-4deg);
}

.upload-button {
  min-width: 140px;
  box-shadow: 0 4px 12px #6558d926;
}

.upload-formats {
  margin-top: 16px;
  margin-bottom: 0;
  letter-spacing: .2px;
}

.upload-privacy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
}

.watermark-type {
  position: relative;
  padding: 4px;
  border-radius: 11px;
  background: var(--muted);
}

.type-indicator {
  position: absolute;
  inset: 4px auto 4px 4px;
  width: calc((100% - 8px) / 2);
  border: 1px solid #e5e1f7;
  border-radius: 8px;
  background: white;
  box-shadow: 0 2px 5px #24263b09;
  transition: transform 320ms cubic-bezier(.22, 1.25, .36, 1);
}

.watermark-type.is-logo .type-indicator {
  transform: translateX(100%);
}

.watermark-type :deep(.ant-radio-group) {
  position: relative;
  display: flex;
}

.watermark-type :deep(.ant-radio-button-wrapper) {
  height: 36px;
  padding-inline: 8px;
  border: 0 !important;
  border-radius: 8px;
  color: var(--muted-foreground);
  background: transparent !important;
  box-shadow: none !important;
  line-height: 36px;
  transition: color 200ms;
}

.watermark-type :deep(.ant-radio-button-wrapper::before) {
  display: none;
}

.watermark-type :deep(.ant-radio-button-wrapper-checked) {
  color: var(--primary);
  font-weight: 600;
}

.watermark-type :deep(.ant-radio-button-wrapper:has(input:focus-visible)) {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

.watermark-type:has(input:disabled) {
  opacity: .55;
}

.export-status {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: 1px solid #e5e1f7;
  border-radius: 12px;
  color: var(--primary);
  background: #f2f0ff;
}

.export-status--done {
  border-color: #d4e9df;
  color: #27815b;
  background: #f0f8f4;
}

.export-status--error {
  border-color: #f1d4d4;
  color: #bd3e3e;
  background: #fff4f4;
}

.status-mark {
  flex: none;
  width: 24px;
  height: 24px;
}

.status-spinner {
  transform-origin: center;
  stroke-dasharray: 35 16;
  animation: status-spin 1s linear infinite;
}

.status-check {
  stroke-dasharray: 24;
  stroke-dashoffset: 0;
  animation: status-draw 300ms ease-out;
}

.content-enter-active,
.content-leave-active,
.settings-enter-active,
.settings-leave-active {
  transition: opacity 160ms ease, transform 160ms ease;
}

.content-enter-from,
.content-leave-to,
.settings-enter-from,
.settings-leave-to {
  opacity: 0;
  transform: translateY(5px);
}

@keyframes status-spin {
  to { transform: rotate(360deg); }
}

@keyframes status-draw {
  from { stroke-dashoffset: 24; }
}

@media (hover: hover) and (pointer: fine) {
  .upload-area:hover {
    border-color: #a499e7;
  }

  .upload-area:hover::before {
    opacity: 1;
  }

  .upload-area:hover .upload-art {
    transform: translateY(-4px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .upload-area,
  .upload-area::before,
  .upload-art,
  .type-indicator,
  .content-enter-active,
  .content-leave-active,
  .settings-enter-active,
  .settings-leave-active {
    transition: none;
  }

  .status-spinner,
  .status-check,
  .image-editor :deep(.ant-progress-bg),
  .image-editor :deep(.ant-progress-bg::before) {
    animation: none !important;
    transition: none !important;
  }

  .content-enter-from,
  .content-leave-to,
  .settings-enter-from,
  .settings-leave-to {
    transform: none;
  }
}

.touch-drag-toggle {
  display: none;
}

.editor-card {
  scroll-margin-top: 12px;
}

.section-link {
  align-items: center;
  min-height: 44px;
  font-size: 14px;
  font-weight: normal;
}

@media (any-pointer: coarse), (max-width: 1023px) {
  .touch-drag-toggle {
    display: inline-flex;
  }

  .thumbnail-remove {
    position: static;
    width: 100%;
    height: 44px;
    margin-top: 4px;
    border-radius: 6px;
    font-size: 20px;
  }
}

@media (max-width: 1023px) {
  .image-editor :deep(.ant-card-head) {
    min-height: 52px;
    padding-inline: 16px;
  }

  .image-editor :deep(.ant-card-body) {
    padding: 16px;
  }

  .image-editor :deep(.ant-btn) {
    min-height: 44px;
    height: auto;
  }

  .image-editor :deep(.ant-radio-button-wrapper) {
    height: 44px;
    line-height: 42px;
  }

  .image-editor :deep(.ant-input),
  .image-editor :deep(.ant-select-selection-search-input) {
    font-size: 16px;
  }

  .image-editor :deep(.ant-select-selector) {
    min-height: 44px;
    align-items: center;
  }

  .image-editor :deep(.ant-checkbox-wrapper) {
    min-height: 44px;
    align-items: center;
  }

  .image-editor :deep(.ant-slider-horizontal) {
    height: 44px;
    padding-block: 20px;
    margin: 0 12px;
  }

  .image-editor :deep(.ant-slider-handle) {
    top: 17px;
  }

  .image-editor :deep(.ant-slider-handle::before) {
    width: 44px;
    height: 44px;
    top: -17px;
    left: -17px;
  }

  .export-actions {
    position: fixed;
    inset: auto 0 0;
    z-index: 20;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
    padding: 12px max(12px, env(safe-area-inset-right)) calc(12px + env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
    border-top: 1px solid var(--border);
    background: var(--card);
    box-shadow: 0 -4px 16px rgb(0 0 0 / 0.04);
  }

  .export-actions :deep(.ant-btn) {
    min-width: 0;
    padding-inline: 8px;
  }

  .export-actions.single-export {
    grid-template-columns: minmax(0, 1fr);
  }

  .preview-canvas {
    width: auto;
    height: auto;
    max-height: 45dvh;
  }

  .section-link {
    display: inline-flex;
  }

  .thumbnail-strip {
    overscroll-behavior-x: contain;
  }

  .color-presets {
    flex-basis: 100%;
  }

  .settings-download {
    display: none;
  }
}
</style>
