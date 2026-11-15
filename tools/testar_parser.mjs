// Testa o extrator com as linhas "ideais" das amostras (sem OCR). Uso: node tools/testar_parser.mjs
import { readFileSync } from 'node:fs';
import { analyze } from '../web/js/extract.js';
const samples = JSON.parse(readFileSync(new URL('./amostras-linhas.json', import.meta.url)));
let ok = 0, total = 0;
for (const s of samples) {
  const r = analyze(s.lines);
  const get = k => k.startsWith('details.') ? r.details[k.slice(8)] : r[k];
  const errs = [];
  if (r.category !== s.category) errs.push(`categoria=${r.category}`);
  for (const [k, v] of Object.entries(s.expect)) { total++; if (get(k) === v) ok++; else errs.push(`${k}: "${get(k)}" ≠ "${v}"`); }
  total++; if (r.category === s.category) ok++;
  console.log(`${errs.length ? '✘' : '✔'} ${s.file} [${r.category}] título="${r.title}"`);
  errs.forEach(e => console.log('    ' + e));
}
// Textos reais devolvidos pelo ML Kit no emulador (ordem do OCR, sem coordenadas)
const real = JSON.parse(readFileSync(new URL('./ocr-real.json', import.meta.url)));
for (const c of real) {
  const r = analyze(c.text.split(' | ').map(t => ({ t })));
  const get = k => k.startsWith('details.') ? r.details[k.slice(8)] : k === 'category' ? r.category : r[k];
  const errs = Object.entries(c.expect).filter(([k, v]) => get(k) !== v).map(([k, v]) => `${k}: "${get(k)}" ≠ "${v}"`);
  total += Object.keys(c.expect).length; ok += Object.keys(c.expect).length - errs.length;
  console.log(`${errs.length ? '✘' : '✔'} OCR real: ${c.name}`); errs.forEach(e => console.log('    ' + e));
}
console.log(`\n${ok}/${total} campos corretos`);
process.exitCode = ok === total ? 0 : 1;
