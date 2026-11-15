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
console.log(`\n${ok}/${total} campos corretos`);
