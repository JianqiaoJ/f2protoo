/**
 * 从专辑封面图片 URL 提取主色，生成用于背景的深色渐变与封面光晕色
 * 用于播放器背景与封面光晕风格统一（参考暖橙棕播放器风格）
 */
export interface AlbumGradientResult {
  from: string;
  to: string;
  /** 光晕用亮色（同色相、更高亮度），用于封面周围多层光晕 */
  glow: string;
}

const DEFAULT_GRADIENT: AlbumGradientResult = {
  from: '#5c3d2e',
  to: '#3d2818',
  glow: 'rgba(230, 140, 70, 0.85)',
};

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      default: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [h * 360, s * 100, l * 100];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
}

/**
 * 从图片 URL 提取主色并返回背景渐变（from/to）与光晕色（glow）
 */
export function extractAlbumGradient(imageUrl: string): Promise<AlbumGradientResult> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = () => resolve(DEFAULT_GRADIENT);
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const size = 64;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(DEFAULT_GRADIENT);
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        let r = 0, g = 0, b = 0;
        const step = 4;
        let count = 0;
        for (let i = 0; i < data.length; i += step * 4) {
          const pr = data[i], pg = data[i + 1], pb = data[i + 2];
          const gray = 0.299 * pr + 0.587 * pg + 0.114 * pb;
          if (gray > 20 && gray < 240) {
            r += pr; g += pg; b += pb;
            count++;
          }
        }
        if (count === 0) {
          resolve(DEFAULT_GRADIENT);
          return;
        }
        r /= count; g /= count; b /= count;
        const [h, s, l] = rgbToHsl(r, g, b);
        const darkL = Math.min(32, l * 0.5);
        const darkerL = Math.min(20, l * 0.35);
        const sat = Math.min(50, s * 0.85);
        const [r1, g1, b1] = hslToRgb(h, sat, darkL);
        const [r2, g2, b2] = hslToRgb(h, sat * 0.9, darkerL);
        const glowL = Math.min(65, l + 25);
        const glowS = Math.min(70, s + 15);
        const [rg, gg, bg] = hslToRgb(h, glowS, glowL);
        const glowHex = toHex(rg, gg, bg);
        resolve({
          from: toHex(r1, g1, b1),
          to: toHex(r2, g2, b2),
          glow: glowHex,
        });
      } catch {
        resolve(DEFAULT_GRADIENT);
      }
    };
    img.src = imageUrl;
  });
}
