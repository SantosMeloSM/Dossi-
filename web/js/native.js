// Ponte com o app Android (quando o Dossiê roda dentro do WebView nativo).
// No navegador comum, todas as funções caem em alternativas web.
import { toB64 } from './crypto.js';

const N = () => window.DossieNative;
export const isNative = () => !!N();

const listeners = new Set();
export const onNativeEvent = fn => listeners.add(fn);
// Chamado pelo lado Kotlin via evaluateJavascript.
window.__dossieNative = {
  emit(type, payload) { listeners.forEach(fn => { try { fn(type, payload); } catch (e) { console.error(e); } }); }
};

export const biometricAvailable = () => { try { return !!N()?.isBiometricAvailable(); } catch { return false; } };
export const biometricEnabled = () => { try { return !!N()?.isBiometricEnabled(); } catch { return false; } };
export const enableBiometric = rawKey => N()?.enableBiometric(toB64(rawKey));
export const disableBiometric = () => N()?.disableBiometric();
export const requestBiometric = () => N()?.requestBiometric();
export const setSecureScreen = on => { try { N()?.setSecureScreen(!!on); } catch { /* opcional */ } };

/** Transfere bytes para o lado nativo em blocos. mode: 'save' | 'share' | 'open' */
async function pushBytes(bytes, name, mime, mode) {
  const n = N();
  if (!n.beginTransfer(name, mime)) throw new Error('Outra transferência está em andamento.');
  try {
    const CHUNK = 96 * 1024;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      if (!n.appendTransfer(toB64(bytes.subarray(i, i + CHUNK)))) throw new Error('Falha ao preparar o arquivo.');
      if (i % (CHUNK * 20) === 0) await new Promise(r => setTimeout(r, 0));
    }
    if (!n.finishTransfer(mode)) throw new Error('Não foi possível concluir.');
  } catch (e) { n.cancelTransfer(); throw e; }
}

function webDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function saveFile(bytes, name, mime) {
  if (isNative()) { await pushBytes(bytes, name, mime, 'save'); return 'native'; }
  webDownload(new Blob([bytes], { type: mime }), name);
  return 'web';
}

export async function saveBlob(blob, name) {
  if (isNative()) return saveFile(new Uint8Array(await blob.arrayBuffer()), name, blob.type || 'application/octet-stream');
  webDownload(blob, name);
  return 'web';
}

/** Compartilha arquivos. Retorna false se não houver suporte (o chamador decide o fallback). */
export async function shareFiles(files, title) {
  if (isNative()) {
    const f = files[0];
    await pushBytes(f.bytes, f.name, f.mime, 'share');
    return true;
  }
  const list = files.map(f => new File([f.bytes], f.name, { type: f.mime }));
  if (navigator.share && navigator.canShare?.({ files: list })) {
    try { await navigator.share({ title, files: list }); } catch (e) { if (e.name !== 'AbortError') throw e; }
    return true;
  }
  return false;
}

export async function shareText(text, title) {
  if (isNative()) { N().shareText(title || 'Dossiê', text); return true; }
  if (navigator.share) {
    try { await navigator.share({ title, text }); } catch (e) { if (e.name !== 'AbortError') throw e; }
    return true;
  }
  return false;
}

/** Abre o arquivo em outro app (Android) ou em nova aba (web). */
export async function openExternally(bytes, name, mime) {
  if (isNative()) { await pushBytes(bytes, name, mime, 'open'); return; }
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const w = window.open(url, '_blank', 'noopener');
  if (!w) webDownload(new Blob([bytes], { type: mime }), name);
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
}

// ---------- leitura de texto (OCR) no aparelho ----------
export const ocrAvailable = () => { try { return !!N()?.isOcrAvailable?.(); } catch { return false; } };
let ocrQueue = Promise.resolve();
let ocrWaiter = null;
onNativeEvent((type, payload) => {
  if (!ocrWaiter) return;
  if (type === 'ocr-result') { const w = ocrWaiter; ocrWaiter = null; try { w.resolve(JSON.parse(payload)); } catch (e) { w.reject(e); } }
  else if (type === 'ocr-error') { const w = ocrWaiter; ocrWaiter = null; w.reject(new Error(payload || 'falha na leitura')); }
});
/** Reconhece o texto de uma imagem ou PDF. Resolve com { lines:[{t,x,y,w,h}], rotation }. */
export function recognize(bytes, mime) {
  const job = ocrQueue.then(() => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { if (ocrWaiter) { ocrWaiter = null; reject(new Error('tempo esgotado')); } }, 120_000);
    ocrWaiter = { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } };
    pushBytes(bytes, 'leitura', mime, 'ocr').catch(e => { const w = ocrWaiter; ocrWaiter = null; w?.reject(e); });
  }));
  ocrQueue = job.catch(() => {});
  return job;
}
