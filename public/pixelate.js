// @ts-check
/* ============================================================
 * 像素化背景模块（pixelate.js）
 * - 房主上传图片 → 降采样像素化 → PNG dataURL（设置房间背景）
 * - 保存当前背景 Image 并应用到画板（低透明度，保证走线清晰）
 * 依赖：board.js（Board.setBg）、globals.d.ts 中的 PixelBG 全局
 * 模块结构见 docs/FRONTEND_MAP.md §1
 * ============================================================ */
'use strict';

/** 像素化后最大边长 */
const MAX_DIM = 192;
/** 像素化结果上限（dataURL 字符数，约 370KB 二进制） */
const MAX_DATAURL = 500000;

/**
 * 按目标最大边长等比缩放
 * @param {number} w 原始宽
 * @param {number} h 原始高
 * @param {number} maxDim 目标最大边长
 * @returns {{w: number, h: number}}
 */
function pickPixelatedSize(w, h, maxDim) {
  const m = Math.max(w, h);
  if (m <= maxDim) return { w: Math.round(w), h: Math.round(h) };
  const k = maxDim / m;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

const PixelBG = {
  /** @type {HTMLImageElement | null} */
  img: null,

  /** 应用背景图片到画板 @param {HTMLImageElement | null} img */
  set(img) {
    this.img = img;
    Board.setBg(img);
  },

  /** 清除背景 */
  clear() {
    this.img = null;
    Board.setBg(null);
  },

  /**
   * 读文件 → 像素化 → PNG dataURL
   * @param {File} file 上传的图片文件
   * @param {(url: string | null) => void} cb 成功回 dataURL，失败/超限回 null
   */
  pixelateFile(file, cb) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          const { w, h } = pickPixelatedSize(img.naturalWidth, img.naturalHeight, MAX_DIM);
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const ctx = c.getContext('2d');
          if (!ctx) { cb(null); return; }
          ctx.imageSmoothingEnabled = false; // 像素风关键：关闭平滑 → 色块化
          ctx.drawImage(img, 0, 0, w, h);
          const url = c.toDataURL('image/png');
          if (url.length > MAX_DATAURL) { cb(null); return; }
          cb(url);
        } catch (e) {
          cb(null);
        }
      };
      img.onerror = () => cb(null);
      img.src = String(reader.result); // readAsDataURL → 必为 string
    };
    reader.onerror = () => cb(null);
    reader.readAsDataURL(file);
  },
};

if (typeof window !== 'undefined') window.PixelBG = PixelBG;
if (typeof module !== 'undefined' && module.exports) module.exports = { pickPixelatedSize };
