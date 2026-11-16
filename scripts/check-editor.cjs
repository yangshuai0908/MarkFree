const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const vue = require('vue');
const ts = require('typescript');
const { parse } = require('@vue/compiler-sfc');
const JSZip = require('jszip');

// Execute the component's actual handlers without mounting its UI.
const { descriptor } = parse(fs.readFileSync('src/views/ImageEditor.vue', 'utf8'));
const script = ts.transpileModule(descriptor.scriptSetup.content + `
globalThis.editor = {
  images, canvasRef, repeat, position, watermarkType, logoImage, touchDragEnabled,
  getPosition, handlePointerDown, handlePointerMove, handlePointerUp,
  renderCanvas, downloadBatchZip,
  downloadSingle, exportStage, batchProcessing, batchProgress, batchTotal, packingProgress,
  sharedSettings, currentSettings, customWatermark, watermarkText, watermarkColor,
  fontSize, opacity, rotation, logoUrl, logoScale, activeItem,
  switchImage, removeImage, clearAllImages, handleLogoChange, removeLogo,
  selectedPosition, selectedPositionIndex,
  tileSpacing, exportFormat, exportQuality, resetSharedSettings,
  adaptiveFont, fontFamily, stagger,
};`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

let sourceImage;
let zipBlob;
const errors = [];
const successes = [];
const dismissTimers = new Map();
const translations = [];
let operations = [];
let cleanup;
const revoked = [];
const pendingLogos = [];
let nextUrl = 0;
const context = {
  save() {}, restore() {}, clearRect() {}, rotate() {},
  strokeText() {},
  measureText(text) { return { width: text.length * 20 }; },
  fillText(text) { operations.push({ text, color: context.fillStyle, alpha: context.globalAlpha, font: context.font, position: translations.at(-1) }); },
  drawImage(image, ...args) {
    if (image.content) { sourceImage = image; operations = []; }
    else operations.push({ logo: image.url, alpha: context.globalAlpha, position: translations.at(-1), args });
  },
  translate(x, y) { translations.push([x, y]); },
};
const canvas = {
  width: 1000, height: 500,
  getContext: () => context,
  getBoundingClientRect: () => ({ width: 500, height: 250 }),
  setPointerCapture() {},
  toBlob: callback => callback(Buffer.from(sourceImage.content)),
};
const sandbox = {
  exports: {},
  setTimeout(callback, delay) {
    if (delay !== 3000) return setTimeout(callback, delay);
    const handle = Symbol('dismiss');
    dismissTimers.set(handle, callback);
    return handle;
  },
  clearTimeout(handle) {
    if (typeof handle === 'symbol') dismissTimers.delete(handle);
    else clearTimeout(handle);
  },
  require(name) {
    if (name === 'vue') return { ...vue, onBeforeUnmount(fn) { cleanup = fn; } };
    if (name === 'ant-design-vue') return {
      message: { success(text) { successes.push(text); }, error(text) { errors.push(text); } },
    };
    if (name.startsWith('.') || name.startsWith('@/')) {
      const baseDir = path.resolve(__dirname, '../src/views');
      const resolved = name.startsWith('@/')
        ? path.resolve(__dirname, '../src', name.slice(2))
        : path.resolve(baseDir, name);
      const candidates = [resolved, `${resolved}.ts`, `${resolved}.js`, path.join(resolved, 'index.ts'), path.join(resolved, 'index.js')];
      for (const file of candidates) {
        if (fs.existsSync(file) && fs.statSync(file).isFile()) {
          const content = fs.readFileSync(file, 'utf8');
          const transpiled = ts.transpileModule(content, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
          const mod = { exports: {} };
          const localRequire = (reqName) => sandbox.require(reqName);
          vm.runInNewContext(transpiled, { ...sandbox, require: localRequire, exports: mod.exports, module: mod });
          return mod.exports;
        }
      }
    }
    return require(name);
  },
  document: {
    createElement: tag => tag === 'canvas' ? canvas : { click() {} },
  },
  URL: {
    createObjectURL(blob) { zipBlob = blob; return `blob:test-${nextUrl++}`; },
    revokeObjectURL(url) { revoked.push(url); },
  },
  defineExpose() {},
  Image: class {
    naturalWidth = 100;
    naturalHeight = 50;
    set src(url) { this.url = url; pendingLogos.push(this); }
  },
};
vm.runInNewContext(script, sandbox);

async function check() {
  const editor = sandbox.editor;
  editor.canvasRef.value = canvas;
  editor.images.value = [{ img: { naturalWidth: 1000, naturalHeight: 500, content: 'first' } }];
  editor.repeat.value = false;
  editor.logoImage.value = { naturalWidth: 100, naturalHeight: 50 };

  for (const mode of ['text', 'logo']) {
    editor.watermarkType.value = mode;
    // Include a return to right-bottom to verify presets reset dragged offsets.
    for (const [preset, x, y] of [
      ['left-top', 0.15, 0.1], ['center', 0.5, 0.5], ['right-bottom', 0.8, 0.85],
    ]) {
      editor.position.value = preset;
      await vue.nextTick();
      assert.equal(editor.selectedPosition.value, preset, 'Clicked preset is selected');
      assert.equal(editor.getPosition(canvas).x, 1000 * x);
      assert.equal(editor.getPosition(canvas).y, 500 * y);
      editor.handlePointerDown({ clientX: 100, clientY: 50, currentTarget: canvas, pointerId: 1 });
      editor.handlePointerMove({ clientX: 150, clientY: 75 });
      editor.handlePointerUp();
      assert.equal(editor.selectedPositionIndex.value, -1, 'Dragging clears the preset highlight');
      const expected = [1000 * (x + 0.1), 500 * (y + 0.1)];
      assert.deepEqual(translations.at(-1), expected, `${mode}: drag from ${preset}`);
      editor.renderCanvas();
      assert.deepEqual(translations.at(-1), expected, `${mode}: position survives re-render`);
    }
  }

  editor.handlePointerDown({ clientX: 0, clientY: 0, currentTarget: canvas, pointerId: 1 });
  editor.handlePointerMove({ clientX: 5000, clientY: -5000 });
  editor.handlePointerUp();
  assert.equal(editor.getPosition(canvas).x, 1000);
  assert.equal(editor.getPosition(canvas).y, 0);

  editor.position.value = 'center';
  await vue.nextTick();
  const touch = { clientX: 0, clientY: 0, currentTarget: canvas, pointerId: 2, pointerType: 'touch' };
  editor.handlePointerDown(touch);
  editor.handlePointerMove({ ...touch, clientX: 50, clientY: 25 });
  assert.equal(editor.getPosition(canvas).x, 500, 'Touch scrolling must not move the watermark');
  editor.touchDragEnabled.value = true;
  editor.handlePointerDown(touch);
  editor.handlePointerMove({ ...touch, clientX: 50, clientY: 25, isPrimary: false });
  assert.equal(editor.getPosition(canvas).x, 500, 'Ignore secondary touches');
  editor.handlePointerMove({ ...touch, clientX: 50, clientY: 25 });
  editor.handlePointerUp();
  assert.equal(editor.getPosition(canvas).x, 600, 'Touch drag moves the watermark when enabled');
  assert.equal(editor.getPosition(canvas).y, 300);
  editor.repeat.value = true;
  await vue.nextTick();
  assert.equal(editor.touchDragEnabled.value, false, 'Tiled mode restores scrolling');
  editor.repeat.value = false;

  editor.watermarkType.value = 'text';
  editor.images.value = ['photo.jpg', 'photo.jpg', 'photo.png', 'other.webp'].map((name, i) => ({
    name, img: { naturalWidth: 1000, naturalHeight: 500, content: `image-${i}` },
  }));
  await vue.nextTick();
  const originalGenerate = JSZip.prototype.generateAsync;
  let sawPacking = false;
  JSZip.prototype.generateAsync = function(options, onUpdate) {
    assert.equal(editor.exportStage.value, 'packing', 'ZIP compression has its own stage');
    assert.equal(editor.batchProcessing.value, true, 'Keep export locked during compression');
    sawPacking = true;
    return originalGenerate.call(this, options, metadata => {
      onUpdate(metadata);
      assert.ok(editor.packingProgress.value <= 99, 'Do not report completion before ZIP resolves');
    });
  };
  try {
    const pending = editor.downloadBatchZip();
    assert.equal(editor.exportStage.value, 'rendering');
    await editor.downloadBatchZip(); // A second click must not start another export.
    await pending;
  } finally {
    JSZip.prototype.generateAsync = originalGenerate;
  }
  assert.equal(sawPacking, true);
  assert.equal(editor.exportStage.value, 'done');
  assert.equal(dismissTimers.size, 1, 'Successful export schedules automatic dismissal');
  assert.deepEqual(successes, [], 'Export must not display a duplicate success toast');
  assert.equal(editor.batchProcessing.value, false);
  assert.equal(editor.packingProgress.value, 100);
  const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
  const names = ['photo_watermark.png', 'photo_watermark_2.png', 'photo_watermark_3.png', 'other_watermark.png'];
  assert.deepEqual(Object.keys(zip.files), names);
  for (const [i, name] of names.entries()) {
    assert.equal(await zip.file(name).async('string'), `image-${i}`);
  }
  assert.deepEqual(errors, []);

  // Verify JPEG export produces .jpg files in ZIP
  editor.exportFormat.value = 'jpeg';
  await editor.downloadBatchZip();
  const jpgZip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
  const jpgNames = ['photo_watermark.jpg', 'photo_watermark_2.jpg', 'photo_watermark_3.jpg', 'other_watermark.jpg'];
  assert.deepEqual(Object.keys(jpgZip.files), jpgNames, 'JPEG format produces .jpg filenames in ZIP');
  editor.exportFormat.value = 'png';

  // Verify tileSpacing and resetSharedSettings
  editor.tileSpacing.value = 180;
  assert.equal(editor.tileSpacing.value, 180);
  editor.resetSharedSettings();
  assert.equal(editor.tileSpacing.value, 100, 'resetSharedSettings resets tileSpacing to default');
  assert.equal(editor.adaptiveFont.value, false);
  editor.adaptiveFont.value = true;
  assert.equal(editor.adaptiveFont.value, true);
  editor.adaptiveFont.value = false;
  editor.fontFamily.value = "'SimSun', serif";
  assert.equal(editor.fontFamily.value, "'SimSun', serif");
  editor.fontFamily.value = "Arial, sans-serif";
  editor.stagger.value = true;
  assert.equal(editor.stagger.value, true);
  editor.stagger.value = false;
  successes.length = 0;

  canvas.toBlob = callback => callback(null);
  await editor.downloadSingle();
  assert.equal(editor.exportStage.value, 'error', 'Failed PNG export is visible and unlocks retry');
  assert.equal(dismissTimers.size, 0, 'Failures remain visible without a dismissal timer');
  assert.equal(editor.batchProcessing.value, false);
  assert.match(errors.pop(), /图片导出失败/);

  canvas.toBlob = callback => callback(Buffer.from('single'));
  await editor.downloadSingle();
  assert.equal(editor.exportStage.value, 'done', 'PNG export can recover from failure');
  assert.equal(editor.batchTotal.value, 1);

  const previousTimer = dismissTimers.keys().next().value;
  const repeatedExport = editor.downloadSingle();
  assert.equal(dismissTimers.size, 0, 'A new export cancels the previous dismissal timer');
  await repeatedExport;
  assert.equal(dismissTimers.size, 1);
  assert.ok(!dismissTimers.has(previousTimer), 'Repeated success gets a fresh display duration');
  const dismiss = dismissTimers.values().next().value;
  dismiss();
  assert.equal(editor.exportStage.value, 'idle', 'Success feedback disappears after its display duration');
  assert.equal(dismissTimers.size, 0);

  JSZip.prototype.generateAsync = () => Promise.reject(new Error('Compression failed'));
  try {
    await editor.downloadBatchZip();
    assert.equal(editor.exportStage.value, 'error', 'ZIP compression failure unlocks retry');
    assert.equal(editor.batchProcessing.value, false);
    assert.match(errors.pop(), /Compression failed/);
  } finally {
    JSZip.prototype.generateAsync = originalGenerate;
  }

  canvas.getContext = () => null;
  await editor.downloadBatchZip();
  assert.equal(editor.exportStage.value, 'error', 'Canvas creation failure unlocks retry');
  assert.equal(editor.batchProcessing.value, false);
  assert.match(errors.pop(), /无法创建画布/);
  assert.deepEqual(errors, []);

  // Shared inheritance, independent settings, and mixed-config ZIP rendering.
  canvas.getContext = () => context;
  canvas.toBlob = callback => callback(Buffer.from(JSON.stringify({ source: sourceImage.content, operations })));
  editor.images.value = ['a', 'b', 'c'].map((name, id) => ({
    id, name: `${name}.png`, url: `blob:image-${id}`,
    img: { naturalWidth: 1000, naturalHeight: 500, content: name },
  }));
  editor.switchImage(0);
  editor.repeat.value = false;
  editor.watermarkText.value = 'shared';
  editor.position.value = 'left-top';
  assert.equal(editor.customWatermark.value, false, 'Imported images inherit shared settings');
  editor.customWatermark.value = true;
  editor.watermarkText.value = 'only-a';
  editor.watermarkColor.value = '#ff4d4f';
  editor.fontSize.value = 72;
  editor.opacity.value = 80;
  editor.position.value = 'center';
  await vue.nextTick();
  editor.handlePointerDown({ clientX: 0, clientY: 0, currentTarget: canvas, pointerId: 1 });
  editor.handlePointerMove({ clientX: 50, clientY: 25 });
  editor.handlePointerUp();
  editor.switchImage(1);
  assert.equal(editor.watermarkText.value, 'shared');
  assert.equal(editor.customWatermark.value, false);
  editor.watermarkText.value = 'shared-updated';
  editor.switchImage(2);
  assert.equal(editor.watermarkText.value, 'shared-updated', 'Other inherited images follow shared edits');
  editor.switchImage(0);
  await vue.nextTick();
  assert.equal(editor.watermarkText.value, 'only-a');
  assert.equal(editor.opacity.value, 80);
  assert.equal(editor.fontSize.value, 72);
  assert.equal(editor.getPosition(canvas).x, 600, 'Switching images preserves dragged offsets');
  assert.equal(editor.getPosition(canvas).y, 300);

  function startLogo() {
    editor.handleLogoChange({ target: { files: [{ type: 'image/png', size: 10 }], value: '' } });
    return pendingLogos.at(-1);
  }
  editor.switchImage(1);
  const sharedLogo = startLogo();
  sharedLogo.onload();
  editor.watermarkType.value = 'logo';
  editor.switchImage(2);
  editor.customWatermark.value = true;
  editor.logoScale.value = 40;
  const individualLogo = startLogo();
  editor.switchImage(0); // A delayed Logo load must stay attached to C, not the active image.
  individualLogo.onload();
  assert.equal(editor.watermarkType.value, 'text');
  editor.switchImage(2);
  assert.equal(editor.logoUrl.value, individualLogo.url);
  editor.switchImage(1);
  assert.equal(editor.logoUrl.value, sharedLogo.url);
  await vue.nextTick();
  const mixedExport = editor.downloadBatchZip();
  editor.sharedSettings.value.logoScale = 60; // A late update must not alter the export snapshot.
  editor.customWatermark.value = true;
  assert.equal(editor.customWatermark.value, false, 'Do not change scope during export');
  await mixedExport;
  const mixedZip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
  const a = JSON.parse(await mixedZip.file('a_watermark.png').async('string'));
  const b = JSON.parse(await mixedZip.file('b_watermark.png').async('string'));
  const c = JSON.parse(await mixedZip.file('c_watermark.png').async('string'));
  assert.equal(a.operations[0].text, 'only-a');
  assert.equal(a.operations[0].color, '#ff4d4f');
  assert.equal(a.operations[0].alpha, 0.8);
  assert.equal(a.operations[0].font, 'bold 72px Arial, sans-serif');
  assert.deepEqual(a.operations[0].position, [600, 300]);
  assert.equal(b.operations[0].logo, sharedLogo.url);
  assert.equal(c.operations[0].logo, individualLogo.url);
  assert.equal(b.operations[0].args[2], 200, 'Shared Logo scale is applied');
  assert.equal(c.operations[0].args[2], 400, 'Individual Logo scale is applied');

  // A cloned Logo must remain alive until its last settings reference is removed.
  editor.customWatermark.value = true; // B snapshots the shared Logo.
  editor.removeLogo(); // B removes its copy, while the shared settings still use it.
  assert.ok(!revoked.includes(sharedLogo.url));
  editor.customWatermark.value = false;
  editor.switchImage(0);
  editor.customWatermark.value = false;
  assert.equal(editor.logoUrl.value, sharedLogo.url, 'Reset resumes the latest shared settings');
  editor.customWatermark.value = true; // A keeps the old Logo when the shared one is replaced.
  editor.switchImage(1);
  const replacement = startLogo();
  editor.switchImage(0);
  replacement.onload();
  assert.equal(editor.logoUrl.value, sharedLogo.url);
  assert.ok(!revoked.includes(sharedLogo.url), 'Replacing the shared Logo preserves independent copies');
  editor.customWatermark.value = false;
  assert.equal(editor.logoUrl.value, replacement.url);
  assert.ok(revoked.includes(sharedLogo.url), 'Release old Logo after its last reference is removed');
  editor.switchImage(2);
  editor.removeImage(0);
  assert.equal(editor.activeItem.value.name, 'c.png', 'Deleting an earlier image preserves selection');
  assert.equal(editor.logoUrl.value, individualLogo.url);
  editor.removeImage(1);
  assert.ok(revoked.includes(individualLogo.url), 'Deleting an image releases its exclusive Logo');
  editor.customWatermark.value = true;
  const abandoned = startLogo();
  editor.customWatermark.value = false;
  abandoned.onload();
  assert.ok(revoked.includes(abandoned.url), 'Discard delayed Logo loads after settings reset');
  editor.clearAllImages();
  assert.ok(!revoked.includes(replacement.url), 'Clearing images preserves the default Logo');
  editor.exportStage.value = 'done';
  assert.equal(dismissTimers.size, 1);
  cleanup();
  assert.equal(dismissTimers.size, 0, 'Unmount cancels pending feedback dismissal');
  assert.ok(revoked.includes(replacement.url), 'Unmount releases the default Logo');
  assert.deepEqual(errors, []);
  console.log('PASS: shared/individual settings, mixed text/Logo ZIP output, retained drag positions, Logo lifecycle, selection, export stages, and failure/retry.');
}

check().catch(error => { console.error(error); process.exitCode = 1; });
