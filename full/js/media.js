// 图片准备：太大就缩一下；涂鸦 PNG 保留透明。

const MAX_EDGE = 1600;
const MAX_RAW_BYTES = 1_200_000;

async function bitmapOf(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch { /* 老 WebView：退回 <img> */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('这张图打不开'));
      img.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

export async function prepareImage(blob) {
  const bitmap = await bitmapOf(blob);
  const width = bitmap.width || bitmap.naturalWidth;
  const height = bitmap.height || bitmap.naturalHeight;
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const isPng = blob.type === 'image/png';

  if (scale === 1 && blob.size <= MAX_RAW_BYTES) {
    bitmap.close?.();
    return { blob, width, height };
  }

  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const out = await new Promise((resolve) => {
    canvas.toBlob(
      (b) => resolve(b),
      isPng ? 'image/png' : 'image/jpeg',
      isPng ? undefined : 0.88
    );
  });

  if (!out) return { blob, width, height };
  return { blob: out, width: w, height: h };
}

// 头像：裁成正方形，边长 400，避免把整张照片塞进库里。
export async function prepareAvatar(file) {
  const bitmap = await bitmapOf(file);
  const w = bitmap.width || bitmap.naturalWidth;
  const h = bitmap.height || bitmap.naturalHeight;
  const side = Math.min(w, h);
  const sx = (w - side) / 2;
  const sy = (h - side) / 2;
  const size = Math.min(400, side);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
  bitmap.close?.();
  const out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  return out || file;
}
