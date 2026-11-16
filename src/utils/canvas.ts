import type { WatermarkSettings, ExportFormat } from "../types/watermark";

//  格式化水印日期
export function formatWatermarkDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

//  获取水印行
export function getWatermarkLines(settings: WatermarkSettings): string[] {
  const lines = settings.watermarkText
    ? settings.watermarkText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
  if (settings.includeDate && settings.watermarkDate) {
    lines.push(formatWatermarkDate(settings.watermarkDate));
  }
  return lines;
}

// 获取位置
export function getPosition(
  canvas: HTMLCanvasElement,
  settings: WatermarkSettings,
): { x: number; y: number } {
  return {
    x: canvas.width * settings.offsetX,
    y: canvas.height * settings.offsetY,
  };
}

// 渲染文字水印
export function renderTextWatermark(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  settings: WatermarkSettings,
): void {
  const { watermarkColor, repeat, rotation } = settings;
  const baseFontSize = settings.fontSize;
  const fontSize =
    settings.adaptiveFont && canvas.width
      ? Math.max(12, Math.round(baseFontSize * (canvas.width / 1920)))
      : baseFontSize;

  const watermarkLines = getWatermarkLines(settings);
  if (watermarkLines.length === 0) return;

  const fontFamily = settings.fontFamily || "Arial, sans-serif";
  ctx.font = `bold ${fontSize}px ${fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = watermarkColor;

  const r = parseInt(watermarkColor.slice(1, 3), 16) || 0;
  const g = parseInt(watermarkColor.slice(3, 5), 16) || 0;
  const b = parseInt(watermarkColor.slice(5, 7), 16) || 0;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  ctx.strokeStyle =
    luminance > 0.5 ? "rgba(0, 0, 0, 0.35)" : "rgba(255, 255, 255, 0.35)";
  ctx.lineWidth = Math.max(1, fontSize / 16);
  ctx.lineJoin = "round";

  // 文本阴影可增强复杂照片背景上的可读性
  ctx.shadowColor =
    luminance > 0.5 ? "rgba(0, 0, 0, 0.4)" : "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = Math.max(2, Math.round(fontSize / 10));
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = Math.max(1, Math.round(fontSize / 20));

  const lineHeight = fontSize * 1.35;
  function drawText() {
    watermarkLines.forEach((text, index) => {
      const y = (index - (watermarkLines.length - 1) / 2) * lineHeight;
      ctx.strokeText(text, 0, y);
      ctx.fillText(text, 0, y);
    });
  }

  if (repeat) {
    const spacingFactor = (settings.tileSpacing ?? 100) / 100;
    const textWidth = Math.max(
      ...watermarkLines.map((text) => ctx.measureText(text).width),
    );
    const textHeight = lineHeight * watermarkLines.length;
    const gapX = Math.max(textWidth + fontSize * 2, 180) * spacingFactor;
    const gapY =
      Math.max(textHeight + fontSize * 2, fontSize * 4, 140) * spacingFactor;

    let rowIndex = 0;
    for (let y = -canvas.height; y < canvas.height * 2; y += gapY) {
      const offsetX = settings.stagger && rowIndex % 2 !== 0 ? gapX / 2 : 0;
      for (
        let x = -canvas.width + offsetX;
        x < canvas.width * 2 + offsetX;
        x += gapX
      ) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((rotation * Math.PI) / 180);
        drawText();
        ctx.restore();
      }
      rowIndex++;
    }
  } else {
    const pos = getPosition(canvas, settings);
    ctx.translate(pos.x, pos.y);
    ctx.rotate((rotation * Math.PI) / 180);
    drawText();
  }
}

// 
export function renderLogoWatermark(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  settings: WatermarkSettings,
): void {
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
    const spacingFactor = (settings.tileSpacing ?? 100) / 100;
    const gapX = Math.max(logoW * 1.8, 180) * spacingFactor;
    const gapY = Math.max(logoH * 2.5, 140) * spacingFactor;

    let rowIndex = 0;
    for (let y = -canvas.height; y < canvas.height * 2; y += gapY) {
      const offsetX = settings.stagger && rowIndex % 2 !== 0 ? gapX / 2 : 0;
      for (
        let x = -canvas.width + offsetX;
        x < canvas.width * 2 + offsetX;
        x += gapX
      ) {
        drawLogo(x, y);
      }
      rowIndex++;
    }
  } else {
    const pos = getPosition(canvas, settings);
    drawLogo(pos.x, pos.y);
  }
}

export function applyWatermark(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  settings: WatermarkSettings,
): void {
  ctx.save();
  ctx.globalAlpha = settings.opacity / 100;

  if (settings.watermarkType === "text") {
    renderTextWatermark(ctx, canvas, settings);
  } else {
    renderLogoWatermark(ctx, canvas, settings);
  }

  ctx.restore();
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  format: ExportFormat = "png",
  quality: number = 90,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const mimeType =
      format === "jpeg"
        ? "image/jpeg"
        : format === "webp"
          ? "image/webp"
          : "image/png";
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("导出失败"));
      },
      mimeType,
      quality / 100,
    );
  });
}
