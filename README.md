# MarkFree

免费的本地图片水印工具，基于 Vue 3、TypeScript、Vite 和 Ant Design Vue。

- 支持 JPG、PNG、WebP 图片，多选或拖拽批量导入，单张最大 50MB。
- 支持文字和 Logo 水印，可调整颜色、大小、透明度、角度、平铺和位置。
- 默认使用统一水印；选中图片后开启「单独设置当前图片」即可独立调整，也可恢复为最新的统一设置。
- 支持导出当前图片为 PNG，或批量打包下载 ZIP。
- 图片仅在浏览器内处理，不会上传服务器。

## 本地开发

```sh
npm install
npm run dev
```

## 构建和预览

```sh
npm run build
npm run preview
```
