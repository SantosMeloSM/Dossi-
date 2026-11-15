// Autoteste da leitura automática. Só roda no APK de depuração (?selftest=1),
// usando os documentos fictícios de /ocr-samples (que não existem na versão de produção).
import { N } from './extract.js';

const log = (...a) => console.log('SELFTEST', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = s => document.querySelector(s);
const approx = s => N(s).replace(/[^A-Z0-9]/g, '');

async function waitFor(fn, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(250); }
  return null;
}

async function unlock() {
  await waitFor(() => $('#pw1') || $('#pw') || !$('#app').hidden, 20000);
  if ($('#pw1')) {
    $('#pw1').value = 'SenhaTeste123'; $('#pw2').value = 'SenhaTeste123';
    $('#auth-form').requestSubmit();
    await waitFor(() => $('#rc-ok'), 30000);
    $('#rc-ok').click(); $('#rc-done').disabled = false; $('#rc-done').click();
  } else if ($('#pw')) {
    $('#pw').value = 'SenhaTeste123';
    $('#auth-form').requestSubmit();
  }
  return waitFor(() => !$('#app').hidden, 30000);
}

function readForm(edit) {
  const d = {};
  document.querySelectorAll('#f-details [data-detail]').forEach(el => { d[el.dataset.detail] = el.value; });
  return {
    category: $('#f-category').value, title: $('#f-title').value,
    number: $('#f-number').value, issuedAt: $('#f-issued').value, expiresAt: $('#f-expires').value,
    details: d, ocr: edit?.lastOcr
  };
}

export async function run(api) {
  if (!(await unlock())) { log('ERRO: não desbloqueou'); log('DONE 0/0'); return; }
  let manifest;
  try { manifest = await (await fetch('ocr-samples/expected.json')).json(); }
  catch { log('ERRO: amostras não encontradas'); log('DONE 0/0'); return; }
  let ok = 0, total = 0;
  for (const s of manifest) {
    document.dispatchEvent(new Event('pointerdown'));
    document.querySelector('[data-act="new"]').click();
    await sleep(300);
    const blob = await (await fetch('ocr-samples/' + s.file)).blob();
    const file = new File([blob], s.file, { type: s.file.endsWith('.png') ? 'image/png' : 'image/jpeg' });
    const t0 = Date.now();
    await api.addFiles([file]);
    await waitFor(() => ['ok', 'info', 'error'].includes($('#ocr-status')?.dataset.state), 120000);
    const f = readForm(api.getEdit());
    const get = k => k.startsWith('details.') ? f.details[k.slice(8)] : f[k];
    const res = [];
    let good = 0, n = 0;
    n++; if (f.category === s.category) good++; else res.push(`categoria "${f.category}" (esperado ${s.category})`);
    for (const [k, v] of Object.entries(s.expect)) {
      n++;
      const got = get(k) || '';
      if (got === v) good++;
      else if (approx(got) === approx(v)) { good++; res.push(`~${k}: "${got}" ≈ "${v}"`); }
      else res.push(`${k}: "${got}" (esperado "${v}")`);
    }
    ok += good; total += n;
    log(`${good === n ? 'OK  ' : 'FALHA'} ${s.file} ${good}/${n} em ${((Date.now() - t0) / 1000).toFixed(1)}s · ${$('#ocr-status')?.textContent?.trim()}`);
    res.forEach(r => log('      ' + r));
    if (good < n && f.ocr) log('      texto lido: ' + String(f.ocr.text).slice(0, 700));
    api.closeEditor();
    await sleep(300);
  }
  log(`DONE ${ok}/${total}`);
}
