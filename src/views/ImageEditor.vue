<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, nextTick } from "vue";
import { message } from "ant-design-vue";

const fileInput = ref<HTMLInputElement>();
const logoInput = ref<HTMLInputElement>();
const canvasRef = ref<HTMLCanvasElement>();
const settingsTab = ref<"content" | "style" | "layout">("content");
const settingsTabs = [
  { value: "content", label: "内容" },
  { value: "style", label: "样式" },
  { value: "layout", label: "布局" },
] as const;
const settingsTabIndex = computed(() => settingsTabs.findIndex(tab => tab.value === settingsTab.value));

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
const positionOptions = [
  { label: "左上角", value: "left-top", x: 0.15, y: 0.1 },
  { label: "居中", value: "center", x: 0.5, y: 0.5 },
  { label: "右下角", value: "right-bottom", x: 0.8, y: 0.85 },
];
const position = computed({
  get: () => currentSettings.value.position,
  set: (value: string) => {
    const settings = currentSettings.value;
    const preset = positionOptions.find(option => option.value === value) ?? positionOptions[2]!;
    settings.position = preset.value;
    settings.offsetX = preset.x;
    settings.offsetY = preset.y;
  },
});
// Dragging can move the watermark away from its last preset.
const selectedPositionIndex = computed(() => positionOptions.findIndex(option =>
  Math.abs(offsetX.value - option.x) < 0.000001 && Math.abs(offsetY.value - option.y) < 0.000001,
));
const selectedPosition = computed({
  get: () => positionOptions[selectedPositionIndex.value]?.value ?? "",
  set: (value: string) => { position.value = value; },
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
    const { default: JSZip } = await import("jszip");
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
  <div class="image-editor">
    <header class="workspace-toolbar">
      <div class="workspace-heading">
        <h1>图片水印</h1>
        <span class="workspace-subtitle">{{ hasImages ? '已导入 ' + images.length + ' 张图片' : '为每一张图片，留下你的标记' }}</span>
      </div>
      <div class="toolbar-actions">
        <a-button v-if="hasImages" class="import-action" :disabled="batchProcessing" @click="selectImage">
          <span aria-hidden="true">＋</span> 添加图片
        </a-button>
        <div class="export-actions" :class="{ 'single-export': images.length <= 1 }" role="group" aria-label="导出图片">
          <a-button :type="images.length > 1 ? 'default' : 'primary'" :disabled="!activeItem || !canvasRef || batchProcessing" :loading="batchProcessing && exportKind === 'single'" @click="downloadSingle">
            {{ images.length > 1 ? '导出当前' : '导出' }}
          </a-button>
          <a-button v-if="images.length > 1" type="primary" :disabled="batchProcessing" :loading="batchProcessing && exportKind === 'zip'" @click="downloadBatchZip">
            {{ batchProcessing && exportKind === 'zip' ? (exportStage === 'packing' ? '正在打包 ZIP…' : '处理中 ' + batchProgress + '/' + batchTotal) : '批量下载 ZIP (' + images.length + ')' }}
          </a-button>
        </div>
      </div>
    </header>

    <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" class="hidden" multiple @change="handleFileChange" />
    <input ref="logoInput" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" class="hidden" @change="handleLogoChange" />

    <Transition name="content">
      <div v-if="exportStage !== 'idle'" class="export-status" :class="'export-status--' + exportStage" role="status" aria-live="polite" aria-atomic="true">
        <svg :key="exportStage" class="status-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <circle v-if="batchProcessing" class="status-spinner" cx="12" cy="12" r="8" />
          <path v-else-if="exportStage === 'done'" class="status-check" d="m5 12 4 4L19 6" />
          <path v-else d="m7 7 10 10M17 7 7 17" />
        </svg>
        <div class="status-content">
          <span>{{ exportLabel }}</span>
          <a-progress v-if="batchProcessing" :key="exportStage" :percent="exportStage === 'packing' ? packingProgress : Math.round((batchProgress / batchTotal) * 100)" :show-info="false" status="active" size="small" />
        </div>
      </div>
    </Transition>

    <main class="editor-workspace">
      <section id="image-preview" class="preview-panel" aria-labelledby="preview-title">
        <header class="panel-header">
          <div class="panel-heading">
            <h2 id="preview-title">图片预览</h2>
            <span class="live-label"><i></i>实时预览</span>
          </div>
          <a href="#watermark-settings" class="section-link">调整水印 ↓</a>
          <span v-if="hasImages" class="image-counter">{{ activeIndex + 1 }} <span>/ {{ images.length }}</span></span>
        </header>
        <div class="preview-body">
          <Transition name="content" mode="out-in">
            <div v-if="!hasImages" key="upload" class="upload-area" :class="{ 'is-file-dragging': uploadDragDepth > 0 }" role="group" aria-label="导入图片"
              @click="selectImage" @pointermove="moveSpotlight" @dragenter.prevent="uploadDragDepth++" @dragover.prevent
              @dragleave.prevent="uploadDragDepth = Math.max(0, uploadDragDepth - 1)" @drop.prevent="handleDrop">
              <div class="upload-art" aria-hidden="true">
                <div class="upload-art-back"></div>
                <div class="upload-art-front">
                  <svg width="42" height="42" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="5" y="5" width="30" height="30" rx="6" /><circle cx="15" cy="15" r="3" /><path d="m6 29 9-9 6 6 6-9 8 12" />
                  </svg>
                </div>
                <span class="upload-art-plus">+</span>
              </div>
              <span class="upload-eyebrow">从一张图片开始</span>
              <h3>{{ uploadDragDepth > 0 ? '松开鼠标，导入图片' : '把图片拖到这里' }}</h3>
              <p>支持多选，轻松为整组图片添加水印</p>
              <a-button type="primary" size="large" class="upload-button">选择图片 <span aria-hidden="true">↗</span></a-button>
              <span class="upload-formats">JPG / PNG / WebP · 单张最大 50MB</span>
              <span class="upload-privacy">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" /><path d="m8 12 3 3 5-6" /></svg>
                图片不会离开你的设备
              </span>
            </div>
            <div v-else key="preview" class="preview-content">
              <div class="image-meta">
                <span class="image-filename" :title="activeItem?.name">{{ activeItem?.name }}</span>
                <span>{{ activeItem?.img.naturalWidth }} × {{ activeItem?.img.naturalHeight }} px</span>
              </div>
              <div class="preview-stage">
                <canvas ref="canvasRef" class="preview-canvas" :class="{ 'cursor-crosshair': !repeat }"
                  :style="{ touchAction: !repeat && touchDragEnabled ? 'none' : 'pan-y pinch-zoom' }"
                  @pointerdown="handlePointerDown" @pointermove="handlePointerMove" @pointerup="handlePointerUp"
                  @pointercancel="handlePointerUp" @lostpointercapture="handlePointerUp" />
              </div>
              <div class="preview-caption">
                <span>{{ repeat ? '平铺水印 · 覆盖整张图片' : touchDragEnabled ? '拖动图片调整水印，完成后关闭移动' : '单个水印 · 可在预览中拖动调整位置' }}</span>
                <a-button v-if="!repeat" class="touch-drag-toggle" size="small" :type="touchDragEnabled ? 'primary' : 'default'" :aria-pressed="touchDragEnabled" @click="touchDragEnabled = !touchDragEnabled">
                  {{ touchDragEnabled ? '完成移动' : '移动水印' }}
                </a-button>
                <span class="scope-caption">{{ customWatermark ? '当前图片单独设置' : '使用统一水印' }}</span>
              </div>
            </div>
          </Transition>
        </div>
        <footer v-if="hasImages" class="image-library">
          <div class="library-header">
            <span>图片列表 <b>{{ images.length }}</b></span>
            <div class="library-actions">
              <a-button type="text" size="small" :disabled="batchProcessing" @click="removeImage(activeIndex)">删除当前</a-button>
              <a-button type="text" size="small" danger :disabled="batchProcessing" @click="clearAllImages">清空</a-button>
            </div>
          </div>
          <div class="thumbnail-strip" aria-label="已导入的图片">
            <button v-for="(item, idx) in images" :key="item.id" type="button" class="thumbnail-button" :class="{ 'is-selected': idx === activeIndex }"
              :aria-label="'预览第 ' + (idx + 1) + ' 张图片：' + item.name + '（' + (item.watermark ? '单独水印' : '统一水印') + '）'" :aria-pressed="idx === activeIndex" @click="switchImage(idx)">
              <span class="thumbnail-image"><img :src="item.url" :alt="item.name" /><span class="thumbnail-number">{{ idx + 1 }}</span><span v-if="item.watermark" class="thumbnail-custom">单独</span></span>
              <span class="thumbnail-name" :title="item.name">{{ item.name }}</span>
            </button>
            <button type="button" class="thumbnail-add" :disabled="batchProcessing" @click="selectImage"><span aria-hidden="true">＋</span>添加图片</button>
          </div>
        </footer>
      </section>

      <aside id="watermark-settings" class="settings-panel" aria-labelledby="settings-title">
        <header class="panel-header">
          <div class="panel-heading"><h2 id="settings-title">水印设置</h2><span class="panel-subtitle">即时生效</span></div>
          <a href="#image-preview" class="section-link">查看预览 ↑</a>
        </header>
        <div class="settings-scope">
          <div class="scope-heading"><span>应用范围</span><span class="scope-badge" :class="{ 'is-custom': customWatermark }">{{ customWatermark ? '仅当前图片' : '统一设置' }}</span></div>
          <div v-if="activeItem" class="scope-controls">
            <a-checkbox v-model:checked="customWatermark" :disabled="batchProcessing">单独设置当前图片</a-checkbox>
            <a-button v-if="customWatermark" type="link" size="small" :disabled="batchProcessing" @click="customWatermark = false">恢复统一设置</a-button>
          </div>
          <p class="scope-note" aria-live="polite" :title="customWatermark ? activeItem?.name : undefined">{{ customWatermark ? activeItem?.name + ' · 修改仅对此图片生效' : '修改会应用到所有未单独设置的图片' }}</p>
        </div>
        <div class="settings-navigation">
          <div class="watermark-type settings-tabs" :style="{ '--segment-count': 3, '--active-index': settingsTabIndex }">
            <span class="type-indicator" aria-hidden="true"></span>
            <a-radio-group v-model:value="settingsTab" aria-label="设置分区" class="w-full">
              <a-radio-button v-for="tab in settingsTabs" :key="tab.value" :value="tab.value">{{ tab.label }}</a-radio-button>
            </a-radio-group>
          </div>
        </div>
        <div class="settings-scroll">
          <fieldset class="settings-fields" :disabled="batchProcessing">
            <Transition name="settings" mode="out-in">
              <div :key="settingsTab" class="settings-page">
                <template v-if="settingsTab === 'content'">
                  <div class="setting-section-title"><h3>水印内容</h3><p>选择文字，或上传你的品牌 Logo</p></div>
                  <div class="watermark-type" :style="{ '--active-index': watermarkType === 'logo' ? 1 : 0 }">
                    <span class="type-indicator" aria-hidden="true"></span>
                    <a-radio-group v-model:value="watermarkType" :disabled="batchProcessing" aria-label="水印类型" class="w-full">
                      <a-radio-button value="text">文字水印</a-radio-button><a-radio-button value="logo">Logo 水印</a-radio-button>
                    </a-radio-group>
                  </div>
                  <Transition name="settings" mode="out-in">
                    <div :key="watermarkType" class="content-fields">
                      <div v-if="watermarkType === 'text'" class="setting-field">
                        <label>水印文字</label>
                        <a-textarea v-model:value="watermarkText" :disabled="batchProcessing" aria-label="水印文字" :rows="4" placeholder="输入你的水印内容" :maxlength="100" show-count />
                        <p class="field-note">简短的文字，让图片保留更多细节。</p>
                      </div>
                      <div v-else class="setting-field">
                        <label>Logo 图片</label>
                        <button v-if="!hasLogo" type="button" class="logo-upload" @click="selectLogo">
                          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="9" cy="9" r="2" /><path d="m3 17 6-5 4 4 3-5 5 6" /></svg>
                          <span>点击上传 Logo</span><small>PNG / JPG / WebP / SVG · 最大 10MB</small>
                        </button>
                        <div v-else class="logo-summary">
                          <img :src="logoUrl" alt="Logo" />
                          <div><strong>{{ logoImage?.naturalWidth }} × {{ logoImage?.naturalHeight }}</strong><span>Logo 已就绪</span></div>
                          <a-button size="small" @click="selectLogo">更换</a-button><a-button size="small" danger @click="removeLogo">删除</a-button>
                        </div>
                        <p class="field-note">透明背景的 Logo，融合效果更自然。</p>
                      </div>
                    </div>
                  </Transition>
                </template>

                <template v-else-if="settingsTab === 'style'">
                  <div class="setting-section-title"><h3>{{ watermarkType === 'text' ? '文字样式' : 'Logo 样式' }}</h3><p>调整大小与透明度，找到恰好的存在感</p></div>
                  <template v-if="watermarkType === 'text'">
                    <div class="setting-field">
                      <label>水印颜色</label>
                      <div class="color-options">
                        <label class="color-custom"><input type="color" v-model="watermarkColor" :disabled="batchProcessing" aria-label="自定义水印颜色" /><span>{{ watermarkColor.toUpperCase() }}</span></label>
                        <div class="color-presets">
                          <button v-for="c in ['#ffffff', '#000000', '#ff4d4f', '#1677ff', '#52c41a', '#faad14']" :key="c" type="button" :aria-label="'水印颜色 ' + c" :aria-pressed="watermarkColor === c" :class="{ 'is-selected': watermarkColor === c }" :style="{ '--swatch-color': c }" @click="watermarkColor = c"><span></span></button>
                        </div>
                      </div>
                    </div>
                    <div class="setting-field"><div class="field-heading"><label>字体大小</label><output>{{ fontSize }}<small>px</small></output></div><a-slider v-model:value="fontSize" :disabled="batchProcessing" :min="12" :max="120" aria-label-for-handle="字体大小" /><div class="range-labels"><span>12 px</span><span>120 px</span></div></div>
                  </template>
                  <div v-else class="setting-field"><div class="field-heading"><label>Logo 大小</label><output>{{ logoScale }}<small>%</small></output></div><a-slider v-model:value="logoScale" :disabled="batchProcessing" :min="3" :max="60" aria-label-for-handle="Logo 大小" /><div class="range-labels"><span>3%</span><span>60%</span></div></div>
                  <div class="setting-field"><div class="field-heading"><label>透明度</label><output>{{ opacity }}<small>%</small></output></div><a-slider v-model:value="opacity" :disabled="batchProcessing" :min="5" :max="100" aria-label-for-handle="透明度" /><div class="range-labels"><span>轻盈</span><span>清晰</span></div></div>
                  <div class="setting-field"><div class="field-heading"><label>旋转角度</label><output>{{ rotation }}<small>°</small></output></div><a-slider v-model:value="rotation" :disabled="batchProcessing" :min="-90" :max="90" aria-label-for-handle="旋转角度" /><div class="range-labels"><span>−90°</span><span>90°</span></div></div>
                </template>

                <template v-else>
                  <div class="setting-section-title"><h3>水印布局</h3><p>整张覆盖，或只在一个位置轻轻标记</p></div>
                  <div class="setting-field">
                    <label>布局方式</label>
                    <div class="watermark-type layout-toggle" :style="{ '--active-index': repeat ? 0 : 1 }">
                      <span class="type-indicator" aria-hidden="true"></span>
                      <a-radio-group v-model:value="repeat" :disabled="batchProcessing" aria-label="水印布局" class="w-full">
                        <a-radio-button :value="true"><span class="layout-option"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3.5" y="3.5" width="6" height="6" rx="1.5" /><rect x="14.5" y="3.5" width="6" height="6" rx="1.5" /><rect x="3.5" y="14.5" width="6" height="6" rx="1.5" /><rect x="14.5" y="14.5" width="6" height="6" rx="1.5" /></svg>平铺水印</span></a-radio-button>
                        <a-radio-button :value="false"><span class="layout-option"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="3" /><rect x="13" y="13" width="4" height="4" rx="1" fill="currentColor" stroke="none" /></svg>单个水印</span></a-radio-button>
                      </a-radio-group>
                    </div>
                    <p class="field-note">{{ repeat ? '覆盖整张图片，适合证件与资料保护。' : '选择预设位置，也可在预览中拖动微调。' }}</p>
                  </div>
                  <Transition name="layout-options">
                    <div v-if="!repeat" class="position-reveal">
                      <div class="position-panel setting-field">
                        <div class="field-heading"><label>水印位置</label><span v-if="selectedPositionIndex < 0" class="field-note">已手动调整</span></div>
                        <div class="watermark-type position-options" :style="{ '--segment-count': 3, '--active-index': Math.max(0, selectedPositionIndex) }">
                          <span class="type-indicator" :style="{ opacity: selectedPositionIndex < 0 ? 0 : 1 }" aria-hidden="true"></span>
                          <a-radio-group v-model:value="selectedPosition" :disabled="batchProcessing" aria-label="水印位置" class="w-full">
                            <a-radio-button v-for="option in positionOptions" :key="option.value" :value="option.value"><span class="layout-option"><svg width="34" height="27" viewBox="0 0 32 26" fill="none" aria-hidden="true"><rect x="3" y="3" width="26" height="20" rx="4" stroke="currentColor" stroke-width="1.3" opacity=".5" /><rect :x="4 + option.x * 24 - 2" :y="4 + option.y * 18 - 1.5" width="4" height="3" rx="1" fill="currentColor" /></svg>{{ option.label }}</span></a-radio-button>
                          </a-radio-group>
                        </div>
                      </div>
                    </div>
                  </Transition>
                </template>
              </div>
            </Transition>
          </fieldset>
        </div>
        <footer class="settings-footer"><span class="footer-dot"></span>所有调整实时预览 · 原尺寸导出</footer>
      </aside>
    </main>
  </div>
</template>

<style scoped>
.image-editor { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.workspace-toolbar { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 18px; }
.workspace-heading { display: flex; align-items: baseline; flex-wrap: wrap; gap: 12px; }
.workspace-heading h1 { margin: 0; font-size: 23px; font-weight: 700; letter-spacing: -.6px; }
.workspace-subtitle { color: var(--muted-foreground); font-size: 12px; }
.toolbar-actions, .export-actions { display: flex; align-items: center; gap: 8px; }
.toolbar-actions :deep(.ant-btn) { height: 38px; padding-inline: 16px; font-size: 13px; }
.editor-workspace { display: grid; grid-template-columns: minmax(0, 1fr) 360px; flex: 1; min-height: 0; gap: 20px; }
.preview-panel, .settings-panel { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; border: 1px solid var(--border); border-radius: 16px; background: white; box-shadow: 0 4px 18px #24263b03; }
.panel-header { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 12px; min-height: 58px; padding: 0 20px; border-bottom: 1px solid #eff0f6; }
.panel-heading { display: flex; align-items: center; gap: 10px; min-width: 0; }
.panel-heading h2 { margin: 0; font-size: 14px; font-weight: 600; white-space: nowrap; }
.panel-subtitle { color: #999cac; font-size: 11px; }
.live-label { display: flex; align-items: center; gap: 5px; color: #85899c; font-size: 10px; }
.live-label i { width: 5px; height: 5px; border-radius: 50%; background: #6db394; }
.image-counter { color: var(--foreground); font-size: 12px; font-variant-numeric: tabular-nums; }
.image-counter span { color: #a1a3b1; }
.section-link { display: none; color: var(--primary); font-size: 12px; }
.preview-body { display: flex; flex: 1; min-height: 0; padding: 16px; }
.preview-content { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; gap: 12px; }
.image-meta { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 12px; color: #9598a8; font-size: 11px; }
.image-filename { overflow: hidden; color: #74788e; text-overflow: ellipsis; white-space: nowrap; }
.image-meta > span:last-child { flex: none; font-variant-numeric: tabular-nums; }
.preview-stage { display: flex; flex: 1; align-items: center; justify-content: center; min-width: 0; min-height: 0; overflow: hidden; border: 1px solid #eeeff5; border-radius: 12px; background-color: #f6f7fb; background-image: radial-gradient(#dfe1ed .7px, transparent .7px); background-size: 12px 12px; padding: 16px; }
.preview-canvas { display: block; width: auto; height: auto; max-width: 100%; max-height: 100%; object-fit: contain; box-shadow: 0 3px 16px #25263b0d; }
.preview-caption { display: flex; flex: none; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; min-height: 20px; color: #8d90a2; font-size: 11px; }
.scope-caption { color: #8a80ba; }
.touch-drag-toggle { display: none; }
.image-library { flex: none; padding: 10px 16px 14px; border-top: 1px solid #eff0f6; }
.library-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; color: #7c8093; font-size: 11px; }
.library-header b { margin-left: 4px; color: var(--foreground); font-weight: 500; }
.library-actions { display: flex; gap: 2px; }
.library-actions :deep(.ant-btn) { height: 24px; padding-inline: 7px; color: #8c8fa1; font-size: 11px; }
.library-actions :deep(.ant-btn-dangerous) { color: #bd6b75; }
.thumbnail-strip { display: flex; gap: 10px; overflow-x: auto; padding: 3px; margin: -3px; overscroll-behavior-x: contain; scrollbar-width: thin; }
.thumbnail-button { flex: none; width: 82px; padding: 4px; border: 1px solid transparent; border-radius: 9px; color: #9295a4; background: transparent; text-align: left; transition: border-color 180ms, background 180ms, transform 180ms; }
.thumbnail-button:hover { background: var(--muted); }
.thumbnail-button.is-selected { border-color: #c7bff3; color: var(--primary); background: #f3f0ff; }
.thumbnail-image { display: block; position: relative; overflow: hidden; height: 48px; border-radius: 5px; background: #eff0f6; }
.thumbnail-image img { width: 100%; height: 100%; object-fit: cover; }
.thumbnail-number, .thumbnail-custom { position: absolute; bottom: 0; padding: 0 4px; font-size: 9px; line-height: 15px; }
.thumbnail-number { left: 0; border-top-right-radius: 4px; color: white; background: #24263b66; }
.thumbnail-custom { right: 0; border-top-left-radius: 4px; color: white; background: #6558d9dd; }
.thumbnail-name { display: block; overflow: hidden; margin-top: 5px; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.thumbnail-add { display: flex; flex: none; align-items: center; justify-content: center; flex-direction: column; gap: 4px; width: 76px; min-height: 72px; border: 1px dashed #dadce8; border-radius: 9px; background: white; color: #989aac; font-size: 10px; transition: color 180ms, border-color 180ms; }
.thumbnail-add > span { font-size: 22px; line-height: 1; }
.thumbnail-add:hover { border-color: var(--primary); color: var(--primary); }
.settings-scope { flex: none; padding: 16px 20px 12px; }
.scope-heading { display: flex; align-items: center; justify-content: space-between; color: #8a8d9f; font-size: 11px; }
.scope-badge { padding: 2px 7px; border-radius: 5px; color: #7c7f92; background: #f1f2f7; font-size: 10px; }
.scope-badge.is-custom { color: var(--primary); background: var(--accent); }
.scope-controls { display: flex; align-items: center; justify-content: space-between; gap: 4px; margin-top: 10px; }
.scope-controls :deep(.ant-checkbox-wrapper) { font-size: 12px; }
.scope-controls :deep(.ant-btn) { height: 24px; padding: 0; font-size: 11px; }
.scope-note { overflow: hidden; margin: 7px 0 0; color: #9a9dad; font-size: 10px; line-height: 1.6; text-overflow: ellipsis; white-space: nowrap; }
.settings-navigation { flex: none; padding: 0 20px 16px; border-bottom: 1px solid #eff0f6; }
.settings-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 20px; scrollbar-width: thin; scrollbar-color: #dddbe9 transparent; }
.settings-fields { min-width: 0; margin: 0; padding: 0; border: 0; }
.settings-page { display: flex; flex-direction: column; gap: 22px; }
.setting-section-title h3 { margin: 0; font-size: 14px; font-weight: 600; }
.setting-section-title p { margin: 5px 0 0; color: #9396a7; font-size: 11px; line-height: 1.6; }
.setting-field { display: flex; flex-direction: column; gap: 10px; }
.setting-field label { color: #64697f; font-size: 12px; font-weight: 500; }
.field-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.field-heading output { padding: 3px 7px; border: 1px solid #eeeaf9; border-radius: 5px; color: var(--primary); background: #faf9ff; font-size: 12px; line-height: 1.2; font-variant-numeric: tabular-nums; }
.field-heading output small { margin-left: 3px; color: #a39bc7; font-size: 10px; }
.setting-field :deep(.ant-slider) { margin: 1px 5px 0; }
.field-note { margin: 0; color: #9b9eae; font-size: 11px; line-height: 1.7; }
.content-fields .field-note { margin-top: 12px; }
.setting-field :deep(.ant-input-textarea-show-count::after) { margin-top: 5px; color: #a8aaba; font-size: 10px; }
.setting-field :deep(textarea.ant-input) { padding: 12px; font-size: 13px; line-height: 1.8; resize: vertical; }
.range-labels { display: flex; justify-content: space-between; margin-top: -5px; color: #aaadbc; font-size: 10px; }
.color-custom { display: flex; align-items: center; gap: 10px; height: 40px; padding: 5px 9px; border: 1px solid var(--border); border-radius: 8px; }
.color-options { display: grid; grid-template-columns: 110px minmax(0, 1fr); align-items: center; gap: 10px; }
.color-custom input { width: 27px; height: 27px; padding: 0; overflow: hidden; border: 1px solid #e2e3ec; border-radius: 5px; cursor: pointer; }
.color-custom > span { color: #8d90a2; font-size: 11px; font-variant-numeric: tabular-nums; }
.color-presets { display: flex; gap: 3px; }
.color-presets button { display: grid; place-items: center; flex: 1; height: 34px; max-width: 40px; padding: 3px; border: 1px solid transparent; border-radius: 50%; background: transparent; transition: border-color 160ms, transform 160ms; }
.color-presets button span { width: 19px; height: 19px; border: 1px solid #24263b16; border-radius: 50%; background: var(--swatch-color); }
.color-presets button.is-selected { border-color: var(--primary); }
.color-presets button:hover { transform: translateY(-2px); }
.logo-upload { display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 12px; min-height: 170px; padding: 20px 10px; border: 1px dashed #d9d5ed; border-radius: 12px; color: var(--primary); background: #faf9ff; transition: border-color 180ms, background 180ms; }
.logo-upload:hover { border-color: var(--primary); background: var(--accent); }
.logo-upload > span { color: #74788e; font-size: 13px; }
.logo-upload small { color: #a2a4b4; font-size: 10px; }
.logo-summary { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 12px; border: 1px solid var(--border); border-radius: 10px; }
.logo-summary > img { width: 44px; height: 44px; object-fit: contain; }
.logo-summary > div { flex: 1; min-width: 80px; }
.logo-summary strong, .logo-summary > div > span { display: block; font-size: 11px; }
.logo-summary strong { font-weight: 500; }
.logo-summary > div > span { margin-top: 4px; color: #a3a5b4; }
.settings-footer { display: flex; flex: none; align-items: center; justify-content: center; gap: 6px; min-height: 42px; border-top: 1px solid #eff0f6; color: #a3a5b5; font-size: 10px; }
.footer-dot { width: 4px; height: 4px; border-radius: 50%; background: #b5addb; }
.watermark-type { position: relative; padding: 4px; border-radius: 10px; background: #f3f3f9; }
.type-indicator { position: absolute; inset: 4px auto 4px 4px; width: calc((100% - 8px) / var(--segment-count, 2)); border: 1px solid #e9e5f6; border-radius: 7px; background: white; box-shadow: 0 2px 5px #24263b07; transform: translateX(calc(var(--active-index, 0) * 100%)); transition: transform 320ms cubic-bezier(.22, 1.25, .36, 1), opacity 160ms; }
.watermark-type :deep(.ant-radio-group) { display: flex; position: relative; width: 100%; }
.watermark-type :deep(.ant-radio-button-wrapper) { display: flex; flex: 1; align-items: center; justify-content: center; min-width: 0; height: 36px; padding-inline: 5px; border: 0 !important; border-radius: 7px; color: #8b8da2; background: transparent !important; box-shadow: none !important; font-size: 12px; line-height: normal; text-align: center; transition: color 180ms; }
.watermark-type :deep(.ant-radio-button-wrapper::before) { display: none; }
.watermark-type :deep(.ant-radio-button-wrapper-checked) { color: var(--primary); font-weight: 600; }
.watermark-type :deep(.ant-radio-button-wrapper:has(input:focus-visible)) { outline: 2px solid var(--ring); outline-offset: 2px; }
.watermark-type:has(input:disabled) { opacity: .55; }
.settings-tabs :deep(.ant-radio-button-wrapper) { height: 32px; }
.layout-toggle :deep(.ant-radio-button-wrapper) { height: 44px; }
.layout-option { display: inline-flex; align-items: center; justify-content: center; gap: 7px; line-height: 1.3; transition: transform 160ms; }
.watermark-type :deep(.ant-radio-button-wrapper:active) .layout-option { transform: scale(.96); }
.position-options :deep(.ant-radio-button-wrapper) { height: 72px; }
.position-options .layout-option { flex-direction: column; gap: 5px; }
.position-reveal { display: grid; grid-template-rows: 1fr; transition: grid-template-rows 240ms, opacity 180ms; }
.position-panel { min-height: 0; overflow: hidden; }
.layout-options-enter-from, .layout-options-leave-to { grid-template-rows: 0fr; opacity: 0; }
.upload-area { display: flex; flex: 1; position: relative; align-items: center; justify-content: center; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; isolation: isolate; padding: 24px; border: 1px dashed #dcd8ee; border-radius: 12px; background: linear-gradient(155deg, #fbfaff, #f8f9fc 70%); text-align: center; cursor: pointer; transition: border-color 200ms, box-shadow 200ms; }
.upload-area::before { content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none; background: radial-gradient(350px circle at var(--spot-x, 50%) var(--spot-y, 45%), #c3b5ff44, transparent 80%); opacity: 0; transition: opacity 250ms; }
.upload-area:focus-within, .upload-area.is-file-dragging { border-color: var(--primary); box-shadow: inset 0 0 0 1px var(--primary); }
.upload-area:focus-within::before, .upload-area.is-file-dragging::before { opacity: 1; }
.upload-art { position: relative; width: 94px; height: 86px; margin-bottom: 28px; pointer-events: none; transition: transform 300ms cubic-bezier(.2,.8,.2,1); }
.upload-art-back, .upload-art-front { display: grid; position: absolute; place-items: center; width: 70px; height: 72px; border: 1px solid #dcd5fa; border-radius: 15px; }
.upload-art-back { top: 4px; left: 3px; background: #eae5ff; transform: rotate(-13deg); }
.upload-art-front { top: 8px; left: 17px; color: var(--primary); background: white; transform: rotate(6deg); box-shadow: 0 8px 20px #6558d912; }
.upload-art-plus { display: grid; position: absolute; right: 0; bottom: 0; place-items: center; width: 28px; height: 28px; border: 3px solid #f8f7fd; border-radius: 50%; color: white; background: var(--primary); font-size: 21px; line-height: 1; }
.upload-eyebrow { margin-bottom: 8px; color: #a19bb9; font-size: 11px; }
.upload-area h3 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -.3px; }
.upload-area > p { margin: 10px 0 0; color: #9295a8; font-size: 12px; }
.upload-button { min-width: 142px; margin-top: 24px; box-shadow: 0 4px 12px #6558d926; }
.upload-formats { margin-top: 16px; color: #a8a9b8; font-size: 10px; letter-spacing: .2px; }
.upload-privacy { display: flex; align-items: center; justify-content: center; gap: 5px; margin-top: 32px; color: #a4a7b5; font-size: 10px; }
.upload-area.is-file-dragging .upload-art { transform: translateY(-6px) rotate(-4deg); }
.export-status { display: flex; flex: none; align-items: center; gap: 10px; margin-bottom: 14px; padding: 9px 14px; border: 1px solid #e5e1f7; border-radius: 10px; color: var(--primary); background: #f2f0ff; }
.export-status--done { border-color: #d4e9df; color: #27815b; background: #f0f8f4; }
.export-status--error { border-color: #f1d4d4; color: #bd3e3e; background: #fff4f4; }
.status-content { flex: 1; min-width: 0; font-size: 12px; }
.status-mark { flex: none; width: 20px; height: 20px; }
.status-spinner { transform-origin: center; stroke-dasharray: 35 16; animation: status-spin 1s linear infinite; }
.status-check { stroke-dasharray: 24; animation: status-draw 300ms ease-out; }
.content-enter-active, .content-leave-active, .settings-enter-active, .settings-leave-active { transition: opacity 160ms, transform 160ms; }
.content-enter-from, .content-leave-to, .settings-enter-from, .settings-leave-to { opacity: 0; transform: translateY(5px); }
@keyframes status-spin { to { transform: rotate(360deg); } }
@keyframes status-draw { from { stroke-dashoffset: 24; } }
@media (hover: hover) and (pointer: fine) {
  .upload-area:hover { border-color: #a499e7; }
  .upload-area:hover::before { opacity: 1; }
  .upload-area:hover .upload-art { transform: translateY(-4px); }
}
@media (any-pointer: coarse) { .touch-drag-toggle { display: inline-flex; } }
@media (min-width: 1440px) { .editor-workspace { grid-template-columns: minmax(0, 1fr) 380px; gap: 24px; } }
@media (max-width: 1023px) {
  .image-editor { height: auto; }
  .workspace-toolbar { align-items: center; padding-bottom: 16px; gap: 10px; }
  .workspace-heading { flex-direction: column; align-items: flex-start; gap: 4px; }
  .workspace-heading h1 { font-size: 21px; }
  .workspace-subtitle { font-size: 11px; }
  .toolbar-actions .import-action { padding-inline: 12px; height: 40px; }
  .editor-workspace { display: flex; flex-direction: column; gap: 16px; }
  .preview-panel, .settings-panel { overflow: hidden; border-radius: 14px; }
  .panel-header { min-height: 54px; padding-inline: 16px; }
  .panel-heading { gap: 7px; }
  .live-label { font-size: 9px; }
  .image-counter { display: none; }
  .section-link { display: inline-flex; align-items: center; min-height: 44px; }
  .preview-body { padding: 12px; }
  .preview-content { gap: 10px; }
  .image-meta { flex-wrap: wrap; gap: 4px 10px; }
  .image-filename { flex: 1; min-width: 0; }
  .preview-stage { flex: auto; height: 38dvh; min-height: 180px; max-height: 360px; padding: 10px; }
  .preview-caption { font-size: 10px; }
  .scope-caption { display: none; }
  .touch-drag-toggle { display: inline-flex; }
  .preview-caption :deep(.ant-btn) { min-height: 36px; font-size: 11px; }
  .image-library { padding: 8px 12px 12px; }
  .library-actions :deep(.ant-btn) { min-height: 40px; padding-inline: 8px; }
  .settings-scope { padding-inline: 16px; }
  .scope-controls { min-height: 40px; }
  .scope-controls :deep(.ant-checkbox-wrapper) { display: flex; align-items: center; min-height: 44px; font-size: 13px; }
  .scope-controls :deep(.ant-btn) { min-height: 44px; font-size: 11px; }
  .scope-note { font-size: 11px; }
  .settings-navigation { padding: 0 16px 16px; }
  .settings-scroll { overflow: visible; padding: 20px 16px 24px; }
  .settings-page { gap: 22px; }
  .setting-field :deep(textarea.ant-input) { font-size: 16px; }
  .watermark-type :deep(.ant-radio-button-wrapper) { min-height: 44px; font-size: 13px; }
  .position-options :deep(.ant-radio-button-wrapper) { min-height: 72px; }
  .color-presets { gap: 7px; }
  .color-options { display: flex; flex-direction: column; align-items: stretch; }
  .color-presets button { height: 44px; max-width: 44px; }
  .color-presets button span { width: 26px; height: 26px; }
  .color-custom { height: 44px; }
  .setting-field :deep(.ant-slider-horizontal) { height: 38px; padding-block: 17px; margin-top: -7px; }
  .setting-field :deep(.ant-slider-handle) { top: 14px; }
  .setting-field :deep(.ant-slider-handle::before) { width: 44px; height: 44px; top: -17px; left: -17px; }
  .range-labels { margin-top: -12px; }
  .upload-area { flex: auto; min-height: 340px; padding: 30px 16px; }
  .upload-art { margin-bottom: 20px; }
  .upload-area h3 { font-size: 20px; }
  .upload-area > p { font-size: 11px; }
  .upload-button { height: 44px; }
  .upload-privacy { margin-top: 24px; }
  .export-actions { position: fixed; inset: auto 0 0; z-index: 20; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); padding: 12px max(12px, env(safe-area-inset-right)) calc(12px + env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left)); border-top: 1px solid var(--border); background: white; box-shadow: 0 -4px 16px #24263b04; }
  .export-actions.single-export { grid-template-columns: minmax(0, 1fr); }
  .export-actions :deep(.ant-btn) { min-width: 0; height: 44px; padding-inline: 8px; font-size: 13px; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; }
  .image-editor :deep(.ant-progress-bg), .image-editor :deep(.ant-progress-bg::before) { transition: none !important; animation: none !important; }
  .content-enter-from, .content-leave-to, .settings-enter-from, .settings-leave-to, .watermark-type :deep(.ant-radio-button-wrapper:active) .layout-option { transform: none; }
}
</style>
