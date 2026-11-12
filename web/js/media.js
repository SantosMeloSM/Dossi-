// Miniaturas de imagens e PDFs, gerados localmente.
export const MAX_FILE = 50 * 1024 * 1024;
export const isImage = mime => /^image\//.test(mime || '');
export const isPdf = (mime, name = '') => mime === 'application/pdf' || /\.pdf$/i.test(name);

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Imagem inválida'));
    img.src = src;
  });
}

async function drawThumb(source, max = 640, quality = 0.8) {
  const w0 = source.width, h0 = source.height;
  const scale = Math.min(1, max / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

export async function imageThumb(bytes, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime || 'image/jpeg' }));
  try { return await drawThumb(await loadImage(url)); }
  catch { return ''; }
  finally { URL.revokeObjectURL(url); }
}

/**
 * Procura imagens JPEG embutidas no PDF (comuns em documentos escaneados ou fotografados)
 * e usa a maior delas como capa. PDFs puramente vetoriais ficam sem miniatura.
 */
export async function pdfThumb(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.length > 40 * 1024 * 1024) return '';
  const candidates = [];
  for (let i = 0; i < data.length - 3 && candidates.length < 12; i++) {
    // Início de JPEG (SOI + marcador) logo após a palavra-chave "stream"
    if (data[i] === 0xFF && data[i + 1] === 0xD8 && data[i + 2] === 0xFF) {
      const before = String.fromCharCode(...data.subarray(Math.max(0, i - 8), i));
      if (!/stream\s*$/.test(before)) continue;
      // Fim: último EOI antes de "endstream"
      let end = -1;
      for (let j = i + 4; j < data.length - 9; j++) {
        if (data[j] === 0x65 && data[j + 1] === 0x6E && data[j + 2] === 0x64 && data[j + 3] === 0x73 && data[j + 4] === 0x74) { end = j; break; }
      }
      if (end < 0) break;
      let eoi = end;
      while (eoi > i && !(data[eoi - 2] === 0xFF && data[eoi - 1] === 0xD9)) eoi--;
      if (eoi - i > 2048) candidates.push(data.subarray(i, eoi));
      i = end;
    }
  }
  let best = null;
  for (const c of candidates) {
    try {
      const bmp = await createImageBitmap(new Blob([c], { type: 'image/jpeg' }));
      const area = bmp.width * bmp.height;
      if (bmp.width >= 120 && bmp.height >= 90 && (!best || area > best.area)) { best?.bmp.close?.(); best = { bmp, area }; }
      else bmp.close?.();
    } catch { /* ignora */ }
  }
  if (!best) return '';
  const out = await drawThumb(best.bmp);
  best.bmp.close?.();
  return out;
}

export async function thumbFor(bytes, mime, name) {
  if (isImage(mime)) return imageThumb(bytes, mime);
  if (isPdf(mime, name)) return pdfThumb(bytes);
  return '';
}

export const safeThumb = t => typeof t === 'string' && t.length < 1_500_000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(t) ? t : '';

export function fileKindIcon(mime, name) {
  if (isImage(mime)) return 'image';
  if (isPdf(mime, name)) return 'pdf';
  return 'file';
}
