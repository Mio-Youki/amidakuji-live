'use strict';
/* ============================================================
 * 像素化背景纯函数测试（public/pixelate.js 的可 Node 测试部分）
 * ============================================================ */
const assert = require('assert');
const { pickPixelatedSize } = require('../public/pixelate.js');

// 等比缩放到最大边长
assert.deepStrictEqual(pickPixelatedSize(4000, 3000, 192), { w: 192, h: 144 }, '横图等比缩放');
assert.deepStrictEqual(pickPixelatedSize(3000, 4000, 192), { w: 144, h: 192 }, '竖图等比缩放');
assert.deepStrictEqual(pickPixelatedSize(2000, 1000, 192), { w: 192, h: 96 }, '宽图保持比例');
assert.deepStrictEqual(pickPixelatedSize(192, 192, 192), { w: 192, h: 192 }, '等于上限不缩放');
assert.deepStrictEqual(pickPixelatedSize(100, 50, 192), { w: 100, h: 50 }, '小于上限原样返回');
assert.deepStrictEqual(pickPixelatedSize(1, 1, 192), { w: 1, h: 1 }, '极小图不小于 1px');
// 防 0 边（超扁图）
const tiny = pickPixelatedSize(5000, 1, 192);
assert.strictEqual(tiny.w, 192);
assert.strictEqual(tiny.h, 1, '超扁图高度至少 1px');
// 任意输入都不超过上限
for (const [w, h] of [[8000, 6000], [4096, 4096], [12345, 7], [3, 99999]]) {
  const s = pickPixelatedSize(w, h, 192);
  assert.ok(Math.max(s.w, s.h) <= 192, `(${w},${h}) → 不超过 192`);
  assert.ok(s.w >= 1 && s.h >= 1, `(${w},${h}) → 不小于 1px`);
}
console.log('✓ 像素化尺寸：等比缩放、上限、防 0 边全部通过');
