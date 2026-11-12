// Utilidades de interface: DOM, toasts, diálogos e folhas modais.
import { icon } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toast(message, kind = 'ok', ms = 3800) {
  const root = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.innerHTML = icon(kind === 'error' ? 'alert' : kind === 'info' ? 'info' : 'check') + `<span>${esc(message)}</span>`;
  root.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); }, ms);
}

export function busy(btn, on, label = 'Aguarde…') {
  if (!btn) return;
  if (on) { btn.dataset.html = btn.innerHTML; btn.innerHTML = `<span class="spinner"></span>${esc(label)}`; btn.disabled = true; }
  else { if (btn.dataset.html) btn.innerHTML = btn.dataset.html; btn.disabled = false; }
}

// ---------- folhas (modais) ----------
const stack = [];
export function openSheet(id) {
  const el = document.getElementById(id);
  if (!el || !el.hidden) return;
  el.hidden = false;
  stack.push(id);
  document.body.classList.add('no-scroll');
  requestAnimationFrame(() => el.classList.add('open'));
  setTimeout(() => el.querySelector('[autofocus], .sheet-body input, .sheet-body button')?.focus?.({ preventScroll: true }), 60);
}
export function closeSheet(id) {
  const el = document.getElementById(id);
  if (!el || el.hidden) return;
  el.classList.remove('open');
  el.hidden = true;
  const i = stack.lastIndexOf(id);
  if (i >= 0) stack.splice(i, 1);
  if (!stack.length) document.body.classList.remove('no-scroll');
  el.dispatchEvent(new CustomEvent('sheetclose'));
}
export const topSheet = () => stack[stack.length - 1] || null;
export const closeAllSheets = () => [...stack].reverse().forEach(closeSheet);

// ---------- diálogo genérico (confirmar / pedir texto) ----------
/**
 * ask({ title, message, input: 'password'|'text'|null, placeholder, confirm, cancel, danger, expect })
 * Resolve com o texto digitado, true (confirmação) ou null (cancelado).
 */
export function ask(opts) {
  return new Promise(resolve => {
    const host = $('#dialog');
    const { title, message = '', input = null, placeholder = '', confirm = 'Confirmar', cancel = 'Cancelar', danger = false, expect = null, html = '' } = opts;
    host.innerHTML = `
      <div class="dialog-backdrop" data-dlg="cancel"></div>
      <form class="dialog-card" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title">
        <div class="dialog-icon ${danger ? 'danger' : ''}">${icon(danger ? 'alert' : input === 'password' ? 'key' : 'info')}</div>
        <h2 id="dlg-title">${esc(title)}</h2>
        ${message ? `<p>${esc(message)}</p>` : ''}${html}
        ${input ? `<div class="input-wrap"><input id="dlg-input" type="${input}" placeholder="${esc(placeholder)}" autocomplete="${input === 'password' ? 'current-password' : 'off'}" required></div>` : ''}
        <div class="dialog-error" id="dlg-err"></div>
        <div class="dialog-actions">
          ${cancel ? `<button type="button" class="btn ghost" data-dlg="cancel">${esc(cancel)}</button>` : ''}
          <button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${esc(confirm)}</button>
        </div>
      </form>`;
    host.hidden = false;
    const form = $('form', host), field = $('#dlg-input', host);
    const done = v => { host.hidden = true; host.innerHTML = ''; document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
    document.addEventListener('keydown', onKey, true);
    host.querySelectorAll('[data-dlg="cancel"]').forEach(b => b.addEventListener('click', () => done(null)));
    form.addEventListener('submit', e => {
      e.preventDefault();
      if (!field) return done(true);
      const v = field.value;
      if (expect && v.trim() !== expect) { $('#dlg-err', host).textContent = `Digite ${expect} para confirmar.`; return; }
      done(v);
    });
    setTimeout(() => (field || $('button[type=submit]', host)).focus(), 30);
  });
}
export const dialogOpen = () => !$('#dialog').hidden;
export const cancelDialog = () => $('#dialog [data-dlg="cancel"]')?.click();

export async function copyText(text, label = 'Copiado.') {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    toast(label);
  } catch { toast('Não foi possível copiar.', 'error'); }
}
