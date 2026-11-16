export type WatermarkType = "text" | "logo"; // 水印类型

export type ExportFormat = "png" | "jpeg" | "webp"; // 导出格式

export type ExportStage = "idle" | "rendering" | "packing" | "done" | "error"; // 导出阶段

// 水印设置
export interface WatermarkSettings {
  watermarkType: WatermarkType; // 水印类型
  watermarkText: string; // 水印文字
  includeDate: boolean; // 是否包含日期
  watermarkDate: string; // 水印日期
  watermarkColor: string; // 水印颜色
  fontSize: number; // 字体大小
  fontFamily?: string; // 字体族
  adaptiveFont?: boolean; // 字体自适应
  logoUrl: string; // logo地址
  logoImage: HTMLImageElement | null; // logo图片
  logoScale: number; // logo缩放
  opacity: number; // 透明度
  rotation: number; // 旋转角度
  repeat: boolean; // 是否重复
  stagger?: boolean; // 是否错位交错平铺
  position: string; // 位置
  offsetX: number; // x轴偏移量
  offsetY: number; // y轴偏移量
  tileSpacing?: number; // 瓦片间距
}

// 图片
export interface ImageItem {
  id: number; // 图片id
  url: string; // 图片地址
  img: HTMLImageElement; // 图片元素
  name: string; // 图片名称
  watermark?: WatermarkSettings; // 水印设置
}

// 位置选项
export interface PositionOption {
  label: string; // 位置选项名称
  value: string; // 位置选项值
  x: number; // x轴偏移量
  y: number; // y轴偏移量
}
