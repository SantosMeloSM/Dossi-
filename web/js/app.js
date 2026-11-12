// Dossiê 2 — cofre pessoal de documentos (local-first, cifrado).
import { icon, hydrateIcons, ICON_NAMES } from './icons.js';
import * as D from './data.js';
import * as V from './vault.js';
import * as S from './store.js';
import * as M from './media.js';
import * as N from './native.js';
import * as B from './backup.js';
import { $, $$, esc, toast, busy, openSheet, closeSheet, topSheet, closeAllSheets, ask, dialogOpen, cancelDialog, copyText } from './ui.js';

// ------------------------------------------------------------------ estado
const pref = (k, d) => { try { return localStorage.getItem('dossie.' + k) ?? d; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem('dossie.' + k, v); } catch { /* opcional */ } };

const state = {
  docs: [], settings: null,
  route: { name: 'home' },
  query: '', filters: { cat: '', person: '', tag: '', status: '' },
  sort: pref('sort', 'recent'), layout: pref('layout', 'grid'),
  edit: null, viewId: null, urls: [],
  viewer: { zoom: 1, rot: 0 },
  idleTimer: null, lastActivity: Date.now(), hiddenAt: 0, revealed: new Set()
};
const uid = () => crypto.randomUUID();
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const live = () => state.docs.filter(d => !d.deletedAt);
const SENSITIVE = new Set(['number', 'cpf', 'renach', 'renavam', 'chassi', 'pis', 'cns']);

// ------------------------------------------------------------------ catálogos
function categories() { return [...D.BUILTIN_CATEGORIES.slice(0, -1), ...(state.settings?.customCategories || []), D.BUILTIN_CATEGORIES.at(-1)]; }
function cat(id) { return categories().find(c => c.id === id) || D.BUILTIN_CATEGORIES.at(-1); }
function people() { return state.settings?.people?.length ? state.settings.people : V.DEFAULT_SETTINGS.people; }
function person(id) { return people().find(p => p.id === id) || people()[0]; }
function allTags() { return [...new Set(live().flatMap(d => d.tags || []))].sort((a, b) => a.localeCompare(b, 'pt-BR')); }
const status = d => D.expiryStatus(d.expiresAt, state.settings.warnDays);
async function persistSettings() { await V.saveSettings(state.settings); }

// ------------------------------------------------------------------ tema
function applyTheme() {
  const t = pref('theme', 'system');
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

// ================================================================== ACESSO
async function showAuth(mode) {
  document.body.classList.add('locked');
  $('#auth').hidden = false;
  $('#app').hidden = true;
  const vault = await V.getVaultRecord();
  mode = mode || (vault ? 'login' : 'setup');
  const panel = $('#auth-panel');
  const pwField = (id, label, auto, extra = '') => `
    <label class="field"><span>${label}</span>
      <div class="input-wrap"><input id="${id}" type="password" autocomplete="${auto}" required ${extra}>
      <button type="button" class="reveal" data-reveal="${id}" aria-label="Mostrar senha">${icon('eye')}</button></div></label>`;

  if (mode === 'setup') {
    panel.innerHTML = `
      <p class="eyebrow">Primeiro acesso</p><h2>Crie a senha do seu cofre</h2>
      <p class="muted">Ela protege a chave que cifra todos os documentos. Use algo longo e fácil de lembrar, como uma frase.</p>
      <form id="auth-form" class="stack">
        ${pwField('pw1', 'Senha (mín. 8 caracteres)', 'new-password', 'minlength="8"')}
        <div class="strength" id="strength"><i></i><i></i><i></i><i></i><span></span></div>
        ${pwField('pw2', 'Confirme a senha', 'new-password', 'minlength="8"')}
        <p class="form-error" id="auth-err"></p>
        <button class="btn primary block" id="auth-go">${icon('shield')} Criar meu cofre</button>
      </form>
      <div class="auth-links"><button class="link" data-auth="restore">${icon('upload')} Já tenho um backup</button></div>`;
    const meter = $('#strength');
    $('#pw1').addEventListener('input', e => {
      const s = D.passwordStrength(e.target.value);
      meter.dataset.level = e.target.value ? s.level : '';
      meter.querySelector('span').textContent = e.target.value ? s.label : '';
    });
    $('#auth-form').addEventListener('submit', async e => {
      e.preventDefault();
      const a = $('#pw1').value, b = $('#pw2').value, err = $('#auth-err');
      if (a.length < 8) return void (err.textContent = 'Use pelo menos 8 caracteres.');
      if (a !== b) return void (err.textContent = 'As senhas não coincidem.');
      busy($('#auth-go'), true, 'Gerando chaves…');
      try {
        const code = await V.createVault(a);
        await enterApp();
        showRecoveryCode(code, true);
      } catch (x) { err.textContent = x.message; }
      finally { busy($('#auth-go'), false); }
    });
  } else if (mode === 'login') {
    const bio = N.biometricAvailable() && N.biometricEnabled();
    panel.innerHTML = `
      <p class="eyebrow">Cofre trancado</p><h2>Bem-vindo de volta</h2>
      <p class="muted">Digite sua senha para abrir seus documentos.</p>
      <form id="auth-form" class="stack">
        ${pwField('pw', 'Senha do cofre', 'current-password')}
        <p class="form-error" id="auth-err"></p>
        <button class="btn primary block" id="auth-go">${icon('unlock')} Desbloquear</button>
        ${bio ? `<button type="button" class="btn soft block" data-auth="bio">${icon('finger')} Usar digital ou PIN do aparelho</button>` : ''}
      </form>
      <div class="auth-links">
        <button class="link" data-auth="recover">${icon('key')} Esqueci a senha</button>
        <button class="link" data-auth="restore">${icon('upload')} Restaurar backup</button>
      </div>`;
    const wait = await V.throttleRemaining();
    if (wait) startThrottleCountdown(wait);
    $('#auth-form').addEventListener('submit', async e => {
      e.preventDefault();
      busy($('#auth-go'), true, 'Abrindo…');
      $('#auth-err').textContent = '';
      try { await V.unlockWithPassword($('#pw').value); await enterApp(); }
      catch (x) {
        $('#auth-err').textContent = x.message;
        const w = await V.throttleRemaining();
        if (w) startThrottleCountdown(w);
        $('#pw').select();
      } finally { busy($('#auth-go'), false); }
    });
    if (bio) setTimeout(() => { if (!V.isUnlocked() && document.visibilityState === 'visible') N.requestBiometric(); }, 400);
    else setTimeout(() => $('#pw')?.focus(), 50);
  } else if (mode === 'recover') {
    panel.innerHTML = `
      <p class="eyebrow">Recuperação</p><h2>Use sua chave de recuperação</h2>
      <p class="muted">A chave tem 25 caracteres (ex.: ABCDE-12345-…) e foi mostrada quando você criou o cofre.</p>
      <form id="auth-form" class="stack">
        <label class="field"><span>Chave de recuperação</span><input id="rc" autocomplete="off" autocapitalize="characters" spellcheck="false" required placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"></label>
        ${pwField('pw1', 'Nova senha', 'new-password', 'minlength="8"')}
        ${pwField('pw2', 'Confirme a nova senha', 'new-password', 'minlength="8"')}
        <p class="form-error" id="auth-err"></p>
        <button class="btn primary block" id="auth-go">${icon('key')} Redefinir senha e abrir</button>
      </form>
      <div class="auth-links"><button class="link" data-auth="login">${icon('chevL')} Voltar</button></div>`;
    $('#auth-form').addEventListener('submit', async e => {
      e.preventDefault();
      const a = $('#pw1').value, err = $('#auth-err');
      if (a.length < 8) return void (err.textContent = 'Use pelo menos 8 caracteres.');
      if (a !== $('#pw2').value) return void (err.textContent = 'As senhas não coincidem.');
      busy($('#auth-go'), true, 'Verificando…');
      try { await V.recoverAndReset($('#rc').value, a); await enterApp(); toast('Senha redefinida. Considere gerar uma nova chave de recuperação.', 'info', 6000); }
      catch (x) { err.textContent = x.message; }
      finally { busy($('#auth-go'), false); }
    });
  }
  hydrateIcons(panel);
}

function startThrottleCountdown(ms) {
  const btn = $('#auth-go'), err = $('#auth-err');
  if (!btn) return;
  const end = Date.now() + ms;
  btn.disabled = true;
  const tick = () => {
    const left = Math.ceil((end - Date.now()) / 1000);
    if (left <= 0 || !document.contains(btn)) { btn.disabled = false; if (err) err.textContent = ''; return; }
    err.textContent = `Muitas tentativas. Tente novamente em ${left}s.`;
    setTimeout(tick, 500);
  };
  tick();
}

async function enterApp() {
  state.settings = await V.loadSettings();
  state.docs = await V.loadDocuments();
  await purgeTrash();
  document.body.classList.remove('locked');
  $('#auth').hidden = true;
  $('#auth-panel').innerHTML = '';
  $('#app').hidden = false;
  N.setSecureScreen(state.settings.secureScreen);
  document.body.classList.toggle('privacy', !!state.settings.privacy);
  document.body.classList.toggle('blur-thumbs', !!state.settings.blurThumbs);
  navigator.storage?.persist?.().catch(() => {});
  state.lastActivity = Date.now();
  armIdle();
  route();
  maybeNotify();
}

function lockApp(reason) {
  if (!V.isUnlocked()) return;
  V.lock();
  // O rascunho em edição é preservado em memória; o resto é descartado.
  ['sheet-view', 'sheet-viewer', 'sheet-generic'].forEach(closeSheet);
  if (dialogOpen()) cancelDialog();
  releaseUrls();
  state.docs = [];
  state.revealed.clear();
  $('#view').innerHTML = '';
  clearTimeout(state.idleTimer);
  showAuth('login');
  if (reason) toast(reason, 'info');
}

function armIdle() {
  clearTimeout(state.idleTimer);
  const min = Number(state.settings?.autoLockMinutes || 0);
  if (!min || !V.isUnlocked()) return;
  state.idleTimer = setTimeout(() => lockApp('Cofre bloqueado por inatividade.'), min * 60_000);
}
function activity() {
  if (!V.isUnlocked()) return;
  const now = Date.now();
  if (now - state.lastActivity > 2000) { state.lastActivity = now; armIdle(); }
}

// ================================================================== ROTAS
function parseHash() {
  const [, name = '', param = ''] = (location.hash || '#/').split('/');
  const p = decodeURIComponent(param);
  if (name === 'cat') return { name: 'cat', param: p };
  if (name === 'person') return { name: 'person', param: p };
  return { name: ['docs', 'expiring', 'favorites', 'trash', 'settings'].includes(name) ? name : 'home' };
}

function route() {
  if (!V.isUnlocked()) return;
  const prev = state.route;
  state.route = parseHash();
  if (prev.name !== state.route.name || prev.param !== state.route.param) {
    state.filters = { cat: '', person: '', tag: '', status: '' };
  }
  render();
  if (prev.name !== state.route.name || prev.param !== state.route.param) window.scrollTo({ top: 0 });
}
const go = hash => { if (location.hash === hash) route(); else location.hash = hash; };

function render() {
  const r = state.route;
  $$('[data-route]').forEach(a => a.classList.toggle('active', a.dataset.route === r.name));
  const all = live();
  const exp = all.filter(d => ['expired', 'soon'].includes(status(d).key)).length;
  $('#nav-count-docs').textContent = all.length || '';
  $('#nav-count-exp').textContent = exp || '';
  const trashN = state.docs.length - all.length;
  $('#nav-count-trash').textContent = trashN || '';
  $('#side-people').innerHTML = people().map(p => `<a href="#/person/${encodeURIComponent(p.id)}" class="${r.name === 'person' && r.param === p.id ? 'active' : ''}"><i class="dot" style="--c:${esc(p.color)}"></i>${esc(p.name)}<b>${all.filter(d => d.personId === p.id).length || ''}</b></a>`).join('');
  $('#side-cats').innerHTML = categories().map(c => { const n = all.filter(d => d.category === c.id).length; return `<a href="#/cat/${encodeURIComponent(c.id)}" class="${r.name === 'cat' && r.param === c.id ? 'active' : ''} ${n ? '' : 'cat-empty'}"><i class="dot" style="--c:${esc(c.color)}"></i>${esc(c.name)}<b>${n || ''}</b></a>`; }).join('');
  $('#privacy-btn').innerHTML = icon(state.settings.privacy ? 'eyeOff' : 'eye');
  $('#privacy-btn').classList.toggle('on', !!state.settings.privacy);

  const view = $('#view');
  if (r.name === 'home') view.innerHTML = viewHome();
  else if (r.name === 'expiring') view.innerHTML = viewExpiring();
  else if (r.name === 'trash') view.innerHTML = viewTrash();
  else if (r.name === 'settings') { view.innerHTML = viewSettings(); fillStorageInfo(); }
  else view.innerHTML = viewDocs();
  hydrateIcons(view);
}

// ------------------------------------------------------------------ componentes
function coverArt(d, size = '') {
  const c = cat(d.category);
  const thumb = M.safeThumb(d.thumb);
  if (thumb) return `<div class="cover has-img ${size}"><img src="${thumb}" alt="" loading="lazy" decoding="async"></div>`;
  return `<div class="cover ${size}" style="--c:${esc(c.color)}"><div class="cover-art">${icon(c.icon)}<span>${esc(c.name)}</span></div></div>`;
}
function statusBadge(d) {
  const s = status(d);
  if (s.key === 'none') return '';
  const text = s.key === 'ok' ? `Válido até ${D.fmtDate(d.expiresAt)}` : s.key === 'expired' ? `Vencido · ${D.fmtDate(d.expiresAt)}` : D.relativeDays(s.n).replace(/^v/, 'V');
  return `<span class="badge ${s.key}">${icon(s.key === 'ok' ? 'check' : s.key === 'expired' ? 'alert' : 'clock')}${esc(text)}</span>`;
}
function docCard(d) {
  const c = cat(d.category), p = person(d.personId);
  const nFiles = d.files?.length || 0;
  return `<article class="doc-card" style="--c:${esc(c.color)}" data-open="${esc(d.id)}" tabindex="0" role="button" aria-label="Abrir ${esc(d.title)}">
    ${coverArt(d)}
    <button class="fav ${d.favorite ? 'on' : ''}" data-fav="${esc(d.id)}" aria-label="${d.favorite ? 'Remover dos favoritos' : 'Favoritar'}">${icon('star')}</button>
    <div class="doc-body">
      <span class="chip" style="--c:${esc(c.color)}">${icon(c.icon)}${esc(c.name)}</span>
      <h3>${esc(d.title)}</h3>
      <p class="doc-sub"><i class="dot" style="--c:${esc(p.color)}"></i>${esc(p.name)}${nFiles ? ` · ${icon('paperclip')}${nFiles}` : ' · só dados'}</p>
      ${d.number ? `<p class="doc-number sensitive" data-mask="${esc(D.mask(d.number))}"><span>${esc(d.number)}</span></p>` : ''}
      ${statusBadge(d)}
    </div>
  </article>`;
}
function docRow(d) {
  const c = cat(d.category), p = person(d.personId);
  return `<article class="doc-row" data-open="${esc(d.id)}" tabindex="0" role="button" style="--c:${esc(c.color)}">
    <span class="row-icon">${M.safeThumb(d.thumb) ? `<img src="${M.safeThumb(d.thumb)}" alt="" loading="lazy">` : icon(c.icon)}</span>
    <div class="row-main"><strong>${esc(d.title)}</strong><small>${esc(c.name)} · ${esc(p.name)}${d.number ? ` · <span class="sensitive" data-mask="${esc(D.mask(d.number))}"><span>${esc(d.number)}</span></span>` : ''}</small></div>
    ${statusBadge(d)}
    <button class="fav ${d.favorite ? 'on' : ''}" data-fav="${esc(d.id)}" aria-label="Favoritar">${icon('star')}</button>
  </article>`;
}
function emptyState(title, text, withButton = true) {
  return `<div class="empty"><div class="empty-art">${icon('folder')}</div><h3>${esc(title)}</h3><p>${esc(text)}</p>${withButton ? `<button class="btn primary" data-act="new">${icon('plus')} Adicionar documento</button>` : ''}</div>`;
}

// ------------------------------------------------------------------ INÍCIO
function viewHome() {
  const all = live();
  const expired = all.filter(d => status(d).key === 'expired');
  const soon = all.filter(d => status(d).key === 'soon').sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
  const favs = all.filter(d => d.favorite);
  const bytes = all.reduce((s, d) => s + (d.files || []).reduce((t, f) => t + (f.size || 0), 0), 0);
  const recent = [...all].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 8);
  const st = state.settings;
  const backupAge = st.lastBackupAt ? D.daysUntil(st.lastBackupAt.slice(0, 10)) * -1 : null;
  const alerts = [];
  if (expired.length) alerts.push(`<a class="alert danger" href="#/expiring">${icon('alert')}<div><strong>${expired.length} documento(s) vencido(s)</strong><small>${esc(expired.slice(0, 3).map(d => d.title).join(', '))}</small></div>${icon('chevR')}</a>`);
  if (soon.length) alerts.push(`<a class="alert warn" href="#/expiring">${icon('clock')}<div><strong>${soon.length} vence(m) em até ${st.warnDays} dias</strong><small>${esc(soon[0].title)} ${esc(D.relativeDays(D.daysUntil(soon[0].expiresAt)))}</small></div>${icon('chevR')}</a>`);
  if (all.length && (backupAge === null || backupAge > 30)) alerts.push(`<button class="alert info" data-act="backup">${icon('download')}<div><strong>${backupAge === null ? 'Você ainda não fez um backup' : `Último backup há ${backupAge} dias`}</strong><small>Sem backup, perder o aparelho significa perder os documentos.</small></div>${icon('chevR')}</button>`);

  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const me = people()[0]?.name;
  return `
  <section class="page-head">
    <div><p class="eyebrow">${esc(D.fmtLongDate(new Date()))}</p>
    <h1>${hello}${me && me !== 'Eu' ? ', ' + esc(me) : ''}.</h1>
    <p class="muted">${all.length ? `Seu cofre guarda ${all.length} documento(s) de ${new Set(all.map(d => d.personId)).size} pessoa(s).` : 'Seu cofre está pronto. Comece pelo documento que você mais usa.'}</p></div>
    <button class="btn primary desktop-only" data-act="new">${icon('plus')} Novo documento</button>
  </section>
  ${alerts.length ? `<section class="alerts">${alerts.join('')}</section>` : ''}
  <section class="stats">
    <a class="stat" href="#/docs"><span>${icon('layers')}</span><strong>${all.length}</strong><small>Documentos</small></a>
    <a class="stat warn" href="#/expiring"><span>${icon('hourglass')}</span><strong>${expired.length + soon.length}</strong><small>Precisam de atenção</small></a>
    <a class="stat" href="#/favorites"><span>${icon('star')}</span><strong>${favs.length}</strong><small>Favoritos</small></a>
    <div class="stat"><span>${icon('database')}</span><strong>${D.fmtBytes(bytes)}</strong><small>Arquivos cifrados</small></div>
  </section>
  ${favs.length ? `<section class="block"><div class="block-head"><h2>Acesso rápido</h2><a href="#/favorites" class="link">Ver todos ${icon('arrowR')}</a></div><div class="quick-row">${favs.slice(0, 10).map(d => `<button class="quick" data-open="${esc(d.id)}" style="--c:${esc(cat(d.category).color)}">${M.safeThumb(d.thumb) ? `<img src="${M.safeThumb(d.thumb)}" alt="">` : icon(cat(d.category).icon)}<span>${esc(d.title)}</span></button>`).join('')}</div></section>` : ''}
  <section class="block">
    <div class="block-head"><h2>Cadastro rápido</h2><p class="muted">Escolha o tipo e os campos certos aparecem.</p></div>
    <div class="template-grid">${categories().map(c => `<button class="template" data-template="${esc(c.id)}" style="--c:${esc(c.color)}"><span class="t-icon">${icon(c.icon)}</span><span><strong>${esc(c.name)}</strong><small>${esc(c.hint || '')}</small></span></button>`).join('')}</div>
  </section>
  <section class="block">
    <div class="block-head"><h2>Recentes</h2>${all.length ? `<a href="#/docs" class="link">Ver todos ${icon('arrowR')}</a>` : ''}</div>
    ${recent.length ? `<div class="grid">${recent.map(docCard).join('')}</div>` : emptyState('Nenhum documento ainda', 'Fotografe ou anexe seu RG, CNH, certidões e o que mais importar.')}
  </section>`;
}

// ------------------------------------------------------------------ LISTAS
function matchQuery(d, q) {
  if (!q) return true;
  const c = cat(d.category), p = person(d.personId);
  const hay = norm([d.title, d.number, d.notes, c.name, p.name, ...(d.tags || []), ...Object.values(d.details || {}), ...(d.files || []).map(f => f.name)].join(' '));
  const digits = D.onlyDigits(q);
  return norm(q).split(/\s+/).every(t => hay.includes(t)) || (digits.length >= 3 && D.onlyDigits(hay).includes(digits));
}
function filteredDocs() {
  const r = state.route, f = state.filters;
  let list = live();
  if (r.name === 'favorites') list = list.filter(d => d.favorite);
  if (r.name === 'cat') list = list.filter(d => d.category === r.param);
  if (r.name === 'person') list = list.filter(d => d.personId === r.param);
  if (f.cat) list = list.filter(d => d.category === f.cat);
  if (f.person) list = list.filter(d => d.personId === f.person);
  if (f.tag) list = list.filter(d => (d.tags || []).includes(f.tag));
  if (f.status) list = list.filter(d => status(d).key === f.status || (f.status === 'attention' && ['expired', 'soon'].includes(status(d).key)));
  list = list.filter(d => matchQuery(d, state.query));
  const by = {
    recent: (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''),
    name: (a, b) => a.title.localeCompare(b.title, 'pt-BR'),
    expiry: (a, b) => (a.expiresAt || '9999').localeCompare(b.expiresAt || '9999'),
    category: (a, b) => cat(a.category).name.localeCompare(cat(b.category).name, 'pt-BR') || a.title.localeCompare(b.title, 'pt-BR')
  };
  return list.sort(by[state.sort] || by.recent);
}
function viewDocs() {
  const r = state.route, f = state.filters;
  let title = 'Documentos', sub = 'Todos os seus arquivos, em um só lugar.', extra = '';
  if (r.name === 'favorites') { title = 'Favoritos'; sub = 'Os que você precisa ter sempre à mão.'; }
  if (r.name === 'cat') {
    const c = cat(r.param); title = c.name; sub = c.hint || '';
    extra = `<button class="btn soft" data-template="${esc(c.id)}">${icon('plus')} Adicionar</button>${c.custom ? `<button class="btn ghost" data-act="edit-category" data-id="${esc(c.id)}">${icon('pencil')} Editar categoria</button>` : ''}`;
  }
  if (r.name === 'person') {
    const p = person(r.param); title = p.name; sub = 'Documentos desta pessoa.';
    extra = `<button class="btn ghost" data-act="edit-person" data-id="${esc(p.id)}">${icon('pencil')} Editar pessoa</button>`;
  }
  const docs = filteredDocs();
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`;
  const tags = allTags();
  const filtersOn = Object.values(f).some(Boolean) || state.query;
  return `
  <section class="page-head">
    <div><p class="eyebrow">${r.name === 'cat' ? 'Categoria' : r.name === 'person' ? 'Pessoa' : 'Biblioteca'}</p><h1>${esc(title)}</h1><p class="muted">${esc(sub)}</p></div>
    <div class="head-actions">${extra}</div>
  </section>
  <section class="toolbar">
    <div class="filters">
      ${r.name !== 'cat' ? `<select data-filter="cat" aria-label="Categoria">${opt('', 'Todas as categorias', f.cat)}${categories().map(c => opt(c.id, c.name, f.cat)).join('')}</select>` : ''}
      ${r.name !== 'person' && people().length > 1 ? `<select data-filter="person" aria-label="Pessoa">${opt('', 'Todas as pessoas', f.person)}${people().map(p => opt(p.id, p.name, f.person)).join('')}</select>` : ''}
      <select data-filter="status" aria-label="Situação">${opt('', 'Qualquer situação', f.status)}${opt('attention', 'Precisam de atenção', f.status)}${opt('expired', 'Vencidos', f.status)}${opt('soon', 'A vencer', f.status)}${opt('ok', 'Válidos', f.status)}${opt('none', 'Sem validade', f.status)}</select>
      ${tags.length ? `<select data-filter="tag" aria-label="Etiqueta">${opt('', 'Todas as etiquetas', f.tag)}${tags.map(t => opt(t, '#' + t, f.tag)).join('')}</select>` : ''}
      ${filtersOn ? `<button class="link" data-act="clear-filters">${icon('x')} Limpar</button>` : ''}
    </div>
    <div class="sorter">
      <select id="sort" aria-label="Ordenar">${opt('recent', 'Recentes', state.sort)}${opt('name', 'Nome (A–Z)', state.sort)}${opt('expiry', 'Vencimento', state.sort)}${opt('category', 'Categoria', state.sort)}</select>
      <div class="seg"><button data-layout="grid" class="${state.layout === 'grid' ? 'on' : ''}" aria-label="Grade">${icon('grid')}</button><button data-layout="list" class="${state.layout === 'list' ? 'on' : ''}" aria-label="Lista">${icon('rows')}</button></div>
    </div>
  </section>
  ${state.query ? `<p class="result-note">${docs.length} resultado(s) para “${esc(state.query)}”</p>` : ''}
  <section id="doc-results" class="${state.layout === 'list' ? 'list' : 'grid'}">
    ${docs.length ? docs.map(state.layout === 'list' ? docRow : docCard).join('') : (filtersOn ? emptyState('Nada encontrado', 'Tente outra palavra ou limpe os filtros.', false) : emptyState('Nada por aqui ainda', 'Adicione o primeiro documento desta lista.'))}
  </section>`;
}
function refreshResults() {
  if (!['docs', 'favorites', 'cat', 'person'].includes(state.route.name)) return render();
  render();
}

// ------------------------------------------------------------------ VENCIMENTOS
function viewExpiring() {
  const withDate = live().filter(d => d.expiresAt).sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
  const groups = [
    ['Vencidos', d => D.daysUntil(d.expiresAt) < 0, 'expired'],
    ['Próximos 7 dias', d => { const n = D.daysUntil(d.expiresAt); return n >= 0 && n <= 7; }, 'soon'],
    ['Próximos 30 dias', d => { const n = D.daysUntil(d.expiresAt); return n > 7 && n <= 30; }, 'soon'],
    ['Próximos 3 meses', d => { const n = D.daysUntil(d.expiresAt); return n > 30 && n <= 90; }, 'ok'],
    ['Mais adiante', d => D.daysUntil(d.expiresAt) > 90, 'ok']
  ];
  const noDate = live().filter(d => !d.expiresAt).length;
  return `
  <section class="page-head">
    <div><p class="eyebrow">Prazos</p><h1>Vencimentos</h1><p class="muted">Avisamos ${state.settings.warnDays} dias antes. Ajuste em Ajustes › Lembretes.</p></div>
    <div class="head-actions">${withDate.length ? `<button class="btn soft" data-act="ics-all">${icon('calendar')} Adicionar todos à agenda</button>` : ''}</div>
  </section>
  ${withDate.length ? groups.map(([label, fn, cls]) => {
    const items = withDate.filter(fn);
    if (!items.length) return '';
    return `<section class="timeline-group ${cls}"><h2>${label}<span>${items.length}</span></h2>
      <ol class="timeline">${items.map(d => {
        const n = D.daysUntil(d.expiresAt), c = cat(d.category);
        return `<li data-open="${esc(d.id)}" tabindex="0" role="button" style="--c:${esc(c.color)}">
          <div class="tl-date"><strong>${d.expiresAt.slice(8, 10)}</strong><small>${new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(d.expiresAt + 'T12:00:00Z'))}</small></div>
          <div class="tl-main"><strong>${esc(d.title)}</strong><small>${esc(c.name)} · ${esc(person(d.personId).name)}</small></div>
          <span class="tl-rel ${cls}">${esc(D.relativeDays(n))}</span>
        </li>`;
      }).join('')}</ol></section>`;
  }).join('') : emptyState('Nenhum prazo cadastrado', 'Informe a data de validade nos documentos para acompanhar os vencimentos aqui.', false)}
  ${noDate ? `<p class="muted center">${noDate} documento(s) sem data de validade.</p>` : ''}`;
}

// ------------------------------------------------------------------ LIXEIRA
function viewTrash() {
  const items = state.docs.filter(d => d.deletedAt).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  const days = state.settings.trashDays;
  return `
  <section class="page-head">
    <div><p class="eyebrow">Recuperação</p><h1>Lixeira</h1><p class="muted">Itens excluídos ficam aqui por ${days} dias e depois são apagados definitivamente.</p></div>
    <div class="head-actions">${items.length ? `<button class="btn danger-soft" data-act="empty-trash">${icon('trash')} Esvaziar lixeira</button>` : ''}</div>
  </section>
  ${items.length ? `<section class="list">${items.map(d => {
    const left = days - Math.floor((Date.now() - new Date(d.deletedAt).getTime()) / 86400000);
    return `<article class="doc-row trash" style="--c:${esc(cat(d.category).color)}">
      <span class="row-icon">${icon(cat(d.category).icon)}</span>
      <div class="row-main"><strong>${esc(d.title)}</strong><small>Excluído em ${new Date(d.deletedAt).toLocaleDateString('pt-BR')} · apagado em ${Math.max(0, left)} dia(s)</small></div>
      <button class="btn soft sm" data-act="restore-doc" data-id="${esc(d.id)}">${icon('restore')} Restaurar</button>
      <button class="icon-btn danger" data-act="purge-doc" data-id="${esc(d.id)}" aria-label="Apagar definitivamente">${icon('trash')}</button>
    </article>`;
  }).join('')}</section>` : emptyState('Lixeira vazia', 'Documentos excluídos aparecem aqui e podem ser restaurados.', false)}`;
}
async function purgeTrash() {
  const limit = Date.now() - state.settings.trashDays * 86400000;
  const old = state.docs.filter(d => d.deletedAt && new Date(d.deletedAt).getTime() < limit);
  for (const d of old) await V.purgeDocument(d.id);
  if (old.length) state.docs = state.docs.filter(d => !old.includes(d));
}

// ------------------------------------------------------------------ AJUSTES
function viewSettings() {
  const st = state.settings;
  const bioAvail = N.biometricAvailable(), bioOn = bioAvail && N.biometricEnabled();
  const theme = pref('theme', 'system');
  const sw = (act, on, label, desc, ic) => `<button class="setting" data-act="${act}" role="switch" aria-checked="${!!on}"><span class="s-icon">${icon(ic)}</span><span class="s-text"><strong>${label}</strong><small>${desc}</small></span><span class="switch ${on ? 'on' : ''}"><i></i></span></button>`;
  const row = (act, label, desc, ic, cls = '') => `<button class="setting ${cls}" data-act="${act}"><span class="s-icon">${icon(ic)}</span><span class="s-text"><strong>${label}</strong><small>${desc}</small></span>${icon('chevR')}</button>`;
  const sel = (id, label, desc, ic, options, cur) => `<label class="setting"><span class="s-icon">${icon(ic)}</span><span class="s-text"><strong>${label}</strong><small>${desc}</small></span><select data-setting="${id}">${options.map(([v, l]) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
  return `
  <section class="page-head"><div><p class="eyebrow">Controle</p><h1>Ajustes</h1><p class="muted">Segurança, privacidade e seus dados.</p></div></section>
  <div class="settings-grid">
  <section class="card-group"><h2>Segurança</h2>
    ${row('change-password', 'Alterar senha', 'A chave dos dados não muda; nada precisa ser recifrado.', 'key')}
    ${row('new-recovery', 'Gerar nova chave de recuperação', st.hasRecovery ? 'Invalida a chave anterior.' : 'Recomendado: você ainda não tem uma.', 'shield')}
    ${bioAvail ? sw('toggle-bio', bioOn, 'Desbloqueio com digital ou PIN', 'Chave protegida pelo Android Keystore.', 'finger') : `<div class="setting disabled"><span class="s-icon">${icon('finger')}</span><span class="s-text"><strong>Desbloqueio biométrico</strong><small>${N.isNative() ? 'Configure digital ou PIN no Android para ativar.' : 'Disponível no app Android.'}</small></span></div>`}
    ${sel('autoLockMinutes', 'Bloqueio automático', 'Após um período sem uso.', 'clock', [[1, '1 minuto'], [5, '5 minutos'], [10, '10 minutos'], [15, '15 minutos'], [30, '30 minutos'], [0, 'Nunca']], st.autoLockMinutes)}
    ${sw('toggle-lockhide', st.lockOnHide, 'Bloquear ao sair do app', 'Tranca se o Dossiê ficar em segundo plano por mais de 30 s.', 'lock')}
    ${N.isNative() ? sw('toggle-secure', st.secureScreen, 'Bloquear capturas de tela', 'Esconde o conteúdo em prints e na tela de apps recentes.', 'eyeOff') : ''}
    ${row('lock', 'Bloquear agora', 'Exige a senha novamente.', 'lock')}
  </section>
  <section class="card-group"><h2>Privacidade</h2>
    ${sw('privacy', st.privacy, 'Ocultar números', 'Mascara números de documentos; toque para revelar.', 'eyeOff')}
    ${sw('toggle-blur', st.blurThumbs, 'Desfocar miniaturas', 'As capas aparecem borradas nas listas.', 'image')}
  </section>
  <section class="card-group"><h2>Lembretes</h2>
    ${sel('warnDays', 'Antecedência do aviso', 'Quando um documento entra em “a vencer”.', 'bell', [[7, '7 dias'], [15, '15 dias'], [30, '30 dias'], [60, '60 dias'], [90, '90 dias']], st.warnDays)}
    ${'Notification' in window && !N.isNative() ? sw('toggle-notify', st.notify && Notification.permission === 'granted', 'Notificações', 'Resumo de vencimentos ao abrir o cofre.', 'bell') : ''}
    ${row('ics-all', 'Exportar prazos para a agenda', 'Arquivo .ics com lembretes para Google Agenda, Outlook etc.', 'calendar')}
  </section>
  <section class="card-group"><h2>Organização</h2>
    ${row('manage-people', 'Pessoas', `${people().length} cadastrada(s): ${esc(people().map(p => p.name).join(', '))}`, 'people')}
    ${row('new-category', 'Nova categoria personalizada', `${(st.customCategories || []).length} criada(s)`, 'tag')}
    ${sel('trashDays', 'Tempo na lixeira', 'Antes de apagar definitivamente.', 'trash', [[7, '7 dias'], [30, '30 dias'], [90, '90 dias']], st.trashDays)}
  </section>
  <section class="card-group"><h2>Aparência</h2>
    <div class="theme-pick">${[['system', 'Sistema', 'monitor'], ['light', 'Claro', 'sun'], ['dark', 'Escuro', 'moon']].map(([v, l, i]) => `<button data-theme-set="${v}" class="${theme === v ? 'on' : ''}">${icon(i)}<span>${l}</span></button>`).join('')}</div>
  </section>
  <section class="card-group"><h2>Backup e dados</h2>
    <p class="muted small">${st.lastBackupAt ? `Último backup: ${new Date(st.lastBackupAt).toLocaleString('pt-BR')}` : 'Nenhum backup feito ainda.'}</p>
    ${row('backup', 'Exportar backup cifrado', 'Um arquivo .json que só abre com a sua senha.', 'download')}
    ${row('restore', 'Importar backup', 'Mescle ou substitua. Aceita backups do Dossiê 1.x.', 'upload')}
    <div class="storage" id="storage-info"><span class="muted small">Calculando armazenamento…</span></div>
    ${row('wipe', 'Apagar tudo deste aparelho', 'Irreversível sem um backup.', 'trash', 'danger')}
  </section>
  <section class="card-group about"><h2>Sobre</h2>
    <p><strong>Dossiê 2.0</strong> · cofre local-first. Criptografia AES‑256‑GCM, chave derivada com PBKDF2‑SHA256 (310 mil iterações). Sem servidores, sem rastreadores, sem contas.</p>
    <p class="muted small">Atalhos: <kbd>/</kbd> buscar · <kbd>N</kbd> novo · <kbd>L</kbd> bloquear · <kbd>P</kbd> ocultar números</p>
  </section>
  </div>`;
}
async function fillStorageInfo() {
  const el = $('#storage-info');
  if (!el) return;
  const mine = live().reduce((s, d) => s + (d.files || []).reduce((t, f) => t + (f.size || 0), 0), 0);
  let html = `<div class="storage-row"><span>Seus arquivos</span><strong>${D.fmtBytes(mine)}</strong></div>`;
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.quota) {
      const pct = Math.min(100, (est.usage / est.quota) * 100);
      html += `<div class="meter"><i style="width:${pct.toFixed(1)}%"></i></div><div class="storage-row muted small"><span>Usado pelo app: ${D.fmtBytes(est.usage)}</span><span>Disponível: ${D.fmtBytes(est.quota - est.usage)}</span></div>`;
    }
    const persisted = await navigator.storage?.persisted?.();
    if (persisted === false) html += `<p class="muted small">${icon('info')} O navegador pode limpar estes dados se faltar espaço. Faça backups.</p>`;
  } catch { /* opcional */ }
  if (document.contains(el)) el.innerHTML = html;
}

// ================================================================== EDITOR
function openEditor(doc = null, presetCat = null) {
  const r = state.route;
  const category = doc?.category || presetCat || (r.name === 'cat' ? r.param : 'identidade');
  state.edit = {
    id: doc?.id || uid(), original: doc,
    files: (doc?.files || []).map(f => ({ meta: { ...f } })),
    removed: [], tags: [...(doc?.tags || [])],
    coverId: doc?.coverId ?? null
  };
  $('#edit-title').textContent = doc ? 'Editar documento' : 'Novo documento';
  $('#edit-eyebrow').textContent = doc ? cat(doc.category).name : 'Novo registro';
  $('#f-category').innerHTML = categories().map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  $('#f-category').value = category;
  $('#f-person').innerHTML = people().map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  $('#f-person').value = doc?.personId || (r.name === 'person' ? r.param : people()[0].id);
  $('#f-title').value = doc?.title || (presetCat && presetCat !== 'outros' ? cat(presetCat).name : '');
  $('#f-number').value = doc?.number || '';
  $('#f-issued').value = doc?.issuedAt || '';
  $('#f-expires').value = doc?.expiresAt || '';
  $('#f-notes').value = doc?.notes || '';
  $('#tag-suggestions').innerHTML = [...new Set([...allTags(), ...D.TAG_SUGGESTIONS])].map(t => `<option value="${esc(t)}">`).join('');
  renderDetails(category, doc?.details || {});
  renderTags();
  renderAttachments();
  renderQuickDates();
  openSheet('sheet-edit');
  if (!doc) setTimeout(() => $('#f-title').select(), 80);
}

function renderDetails(categoryId, values = null) {
  const c = cat(categoryId);
  const current = values || readDetails();
  $('#f-number-label').textContent = c.numberLabel || 'Número';
  const numIn = $('#f-number');
  numIn.inputMode = c.numberType === 'cpf' ? 'numeric' : 'text';
  numIn.placeholder = c.numberType === 'cpf' ? '000.000.000-00' : 'Opcional';
  validateNumber();
  const known = new Set(c.fields.map(f => f[0]));
  const extras = Object.keys(current).filter(k => !known.has(k) && current[k]);
  const fields = [...c.fields, ...extras.map(k => [k, k.charAt(0).toUpperCase() + k.slice(1)])];
  $('#f-details').innerHTML = fields.map(([key, label, type, options]) => {
    const v = current[key] || '';
    let input;
    if (type === 'date') input = `<input type="date" data-detail="${esc(key)}" value="${esc(v)}">`;
    else if (type === 'select') input = `<select data-detail="${esc(key)}"><option value="">—</option>${[...options, ...(v && !options.includes(v) ? [v] : [])].map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    else input = `<input data-detail="${esc(key)}" data-type="${esc(type || 'text')}" value="${esc(v)}" maxlength="140" autocomplete="off" ${type === 'cpf' ? 'inputmode="numeric" placeholder="000.000.000-00"' : type === 'plate' ? 'placeholder="ABC1D23" autocapitalize="characters"' : ''}>`;
    return `<label class="field"><span>${esc(label)}</span>${input}<small class="hint"></small></label>`;
  }).join('');
}
function readDetails() {
  const out = {};
  $$('#f-details [data-detail]').forEach(el => { const v = el.value.trim(); if (v) out[el.dataset.detail] = v; });
  return out;
}
function validateNumber() {
  const c = cat($('#f-category').value), el = $('#f-number'), hint = $('#f-number-hint');
  if (c.numberType === 'cpf' && el.value) {
    el.value = D.formatCPF(el.value);
    const ok = D.isValidCPF(el.value);
    hint.textContent = D.onlyDigits(el.value).length === 11 ? (ok ? '✓ CPF válido' : 'CPF com dígito verificador inválido') : '';
    hint.className = 'hint ' + (D.onlyDigits(el.value).length === 11 ? (ok ? 'ok' : 'bad') : '');
  } else { hint.textContent = ''; hint.className = 'hint'; }
}
function renderTags() {
  const box = $('#tag-input');
  $$('.tag', box).forEach(t => t.remove());
  state.edit.tags.forEach(t => {
    const el = document.createElement('span');
    el.className = 'tag';
    el.innerHTML = `#${esc(t)}<button type="button" data-untag="${esc(t)}" aria-label="Remover ${esc(t)}">${icon('x')}</button>`;
    box.insertBefore(el, $('#f-tag'));
  });
}
function addTag(raw) {
  const t = raw.trim().replace(/^#/, '').toLowerCase().slice(0, 30);
  if (t && !state.edit.tags.includes(t) && state.edit.tags.length < 12) { state.edit.tags.push(t); renderTags(); }
}
function renderQuickDates() {
  const box = $('#quick-dates');
  box.innerHTML = `<span class="muted small">Validade rápida:</span>` + [[1, '+1 ano'], [5, '+5 anos'], [10, '+10 anos']].map(([y, l]) => `<button type="button" class="pill" data-years="${y}">${l}</button>`).join('') + `<button type="button" class="pill" data-years="0">sem validade</button>`;
}
function renderAttachments() {
  const e = state.edit;
  if (!e.coverId || !e.files.some(f => f.meta.id === e.coverId)) {
    const first = e.files.find(f => M.isImage(f.meta.mime) || M.isPdf(f.meta.mime, f.meta.name));
    e.coverId = first?.meta.id || null;
  }
  $('#attach-list').innerHTML = e.files.map((f, i) => {
    const m = f.meta, cover = m.id === e.coverId;
    const thumb = f.previewUrl ? `<img src="${f.previewUrl}" alt="">` : cover && M.safeThumb(e.original?.thumb) && !f.bytes ? `<img src="${M.safeThumb(e.original.thumb)}" alt="">` : icon(M.fileKindIcon(m.mime, m.name));
    return `<div class="attach ${cover ? 'is-cover' : ''}" data-index="${i}">
      <span class="a-thumb">${thumb}</span>
      <div class="a-info"><input class="a-label" data-label="${i}" value="${esc(m.label || '')}" placeholder="${i === 0 ? 'Frente' : i === 1 ? 'Verso' : 'Página ' + (i + 1)}" maxlength="30" aria-label="Rótulo do anexo"><small>${esc(m.name)} · ${D.fmtBytes(m.size)}${f.bytes ? ' · novo' : ''}</small></div>
      ${(M.isImage(m.mime) || M.isPdf(m.mime, m.name)) ? `<button type="button" class="icon-btn sm ${cover ? 'on' : ''}" data-cover="${i}" title="Usar como capa" aria-label="Usar como capa">${icon('star')}</button>` : ''}
      ${i > 0 ? `<button type="button" class="icon-btn sm" data-move="${i}" title="Mover para cima" aria-label="Mover para cima">${icon('chevL')}</button>` : ''}
      <button type="button" class="icon-btn sm danger" data-remove-file="${i}" aria-label="Remover anexo">${icon('trash')}</button>
    </div>`;
  }).join('');
  $('#attach-drop').classList.toggle('compact', e.files.length > 0);
}
async function addFiles(fileList) {
  const e = state.edit;
  if (!e) return;
  for (const file of fileList) {
    if (file.size > M.MAX_FILE) { toast(`${file.name}: maior que 50 MB.`, 'error'); continue; }
    if (e.files.length >= 20) { toast('Limite de 20 anexos por documento.', 'error'); break; }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = file.type || (M.isPdf('', file.name) ? 'application/pdf' : 'application/octet-stream');
    const name = file.name && file.name !== 'image.jpg' ? file.name : `foto-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`;
    const item = { meta: { id: uid(), name, mime, size: bytes.length, label: '' }, bytes };
    if (M.isImage(mime)) item.previewUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
    e.files.push(item);
    if (!$('#f-title').value.trim()) $('#f-title').value = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 120);
  }
  renderAttachments();
}
function releaseEditUrls() { state.edit?.files.forEach(f => f.previewUrl && URL.revokeObjectURL(f.previewUrl)); }

async function saveEditor(ev) {
  ev.preventDefault();
  const e = state.edit, btn = $('#edit-save');
  const title = $('#f-title').value.trim();
  if (!title) { toast('Dê um nome ao documento.', 'error'); $('#f-title').focus(); return; }
  const issuedAt = $('#f-issued').value, expiresAt = $('#f-expires').value;
  if (issuedAt && expiresAt && issuedAt > expiresAt) { toast('A validade precisa ser depois da emissão.', 'error'); return; }
  const category = $('#f-category').value, c = cat(category);
  const details = readDetails();
  const cpfs = [c.numberType === 'cpf' ? $('#f-number').value : null, ...c.fields.filter(f => f[2] === 'cpf').map(f => details[f[0]])].filter(Boolean);
  if (cpfs.some(v => !D.isValidCPF(v))) {
    const ok = await ask({ title: 'CPF parece inválido', message: 'Os dígitos verificadores não conferem. Salvar mesmo assim?', confirm: 'Salvar assim' });
    if (!ok) return;
  }
  const pending = $('#f-tag').value; if (pending.trim()) { addTag(pending); $('#f-tag').value = ''; }
  busy(btn, true, 'Cifrando…');
  try {
    const prev = e.original;
    let thumb = prev?.thumb || '';
    const coverItem = e.files.find(f => f.meta.id === e.coverId);
    if (!coverItem) thumb = e.files.length ? '' : (prev && !prev.files?.length ? prev.thumb || '' : '');
    else if (coverItem.bytes) thumb = await M.thumbFor(coverItem.bytes, coverItem.meta.mime, coverItem.meta.name);
    else if (e.coverId !== prev?.coverId || !thumb) {
      try { thumb = await M.thumbFor(await V.readFile(e.id, e.coverId), coverItem.meta.mime, coverItem.meta.name); } catch { thumb = ''; }
    }
    const now = new Date().toISOString();
    const doc = {
      id: e.id, title, category, personId: $('#f-person').value,
      number: $('#f-number').value.trim(), issuedAt, expiresAt,
      details, tags: e.tags, notes: $('#f-notes').value.trim(),
      favorite: prev?.favorite || false, createdAt: prev?.createdAt || now, updatedAt: now, deletedAt: null,
      files: e.files.map(f => f.meta), coverId: e.coverId, thumb: M.safeThumb(thumb)
    };
    const added = e.files.filter(f => f.bytes).map(f => ({ meta: f.meta, bytes: f.bytes }));
    await V.saveDocument(doc, added, e.removed);
    const i = state.docs.findIndex(d => d.id === doc.id);
    if (i >= 0) state.docs[i] = doc; else state.docs.push(doc);
    releaseEditUrls();
    state.edit = null;
    closeSheet('sheet-edit');
    render();
    toast(prev ? 'Documento atualizado.' : 'Documento guardado e cifrado.');
    if (state.viewId === doc.id) openView(doc.id);
  } catch (x) { console.error(x); toast('Não foi possível salvar: ' + x.message, 'error'); }
  finally { busy(btn, false); }
}

// ================================================================== VISUALIZAÇÃO
function releaseUrls() { state.urls.forEach(u => URL.revokeObjectURL(u)); state.urls = []; }
const findDoc = id => state.docs.find(d => d.id === id);

function detailRows(d) {
  const c = cat(d.category);
  const rows = [];
  if (d.number) rows.push(['number', c.numberLabel || 'Número', d.number]);
  const known = new Map(c.fields.map(f => [f[0], f]));
  for (const [k, f] of known) if (d.details?.[k]) rows.push([k, f[1], f[2] === 'date' ? D.fmtDate(d.details[k]) : d.details[k]]);
  for (const [k, v] of Object.entries(d.details || {})) if (!known.has(k) && v) rows.push([k, k.charAt(0).toUpperCase() + k.slice(1), v]);
  if (d.issuedAt) rows.push(['issued', 'Emissão', D.fmtDate(d.issuedAt)]);
  if (d.expiresAt) rows.push(['expires', 'Validade', `${D.fmtDate(d.expiresAt)} (${D.relativeDays(D.daysUntil(d.expiresAt))})`]);
  return rows;
}

async function openView(id) {
  const d = findDoc(id);
  if (!d) return;
  releaseUrls();
  state.viewId = id;
  const c = cat(d.category), p = person(d.personId);
  const files = d.files || [];
  const rows = detailRows(d);
  const card = $('#view-card');
  card.innerHTML = `
    <header class="sheet-head view-head" style="--c:${esc(c.color)}">
      <div class="view-title">
        <span class="chip" style="--c:${esc(c.color)}">${icon(c.icon)}${esc(c.name)}</span>
        <h2 id="view-title">${esc(d.title)}</h2>
        <p class="muted"><i class="dot" style="--c:${esc(p.color)}"></i>${esc(p.name)} · atualizado em ${new Date(d.updatedAt).toLocaleDateString('pt-BR')}</p>
      </div>
      <div class="head-tools">
        <button class="icon-btn fav-big ${d.favorite ? 'on' : ''}" data-fav="${esc(d.id)}" aria-label="Favorito">${icon('star')}</button>
        <button class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button>
      </div>
    </header>
    <div class="sheet-body">
      ${statusBadge(d) ? `<div class="view-status">${statusBadge(d)}</div>` : ''}
      ${files.length ? `<div class="gallery">${files.map((f, i) => `<button class="g-item" data-file="${i}" aria-label="Abrir ${esc(f.label || f.name)}">
          <span class="g-thumb" id="g-${i}">${f.id === d.coverId && M.safeThumb(d.thumb) ? `<img src="${M.safeThumb(d.thumb)}" alt="">` : icon(M.fileKindIcon(f.mime, f.name))}</span>
          <span class="g-label">${esc(f.label || (files.length > 1 ? (i === 0 ? 'Frente' : i === 1 ? 'Verso' : 'Página ' + (i + 1)) : M.isPdf(f.mime, f.name) ? 'PDF' : 'Arquivo'))}</span>
        </button>`).join('')}</div>` : `<div class="no-files">${icon('text')}<span>Registro só com dados — sem arquivo anexado.</span></div>`}
      ${rows.length ? `<dl class="details">${rows.map(([k, label, v]) => {
        const sens = SENSITIVE.has(k);
        const shown = !sens || !state.settings.privacy || state.revealed.has(d.id + k);
        return `<div class="d-row"><dt>${esc(label)}</dt><dd><span class="d-val">${esc(shown ? v : D.mask(v))}</span>
          ${sens && state.settings.privacy ? `<button class="icon-btn sm" data-reveal-field="${esc(k)}" aria-label="Mostrar">${icon(shown ? 'eyeOff' : 'eye')}</button>` : ''}
          <button class="icon-btn sm" data-copy="${esc(v)}" aria-label="Copiar ${esc(label)}">${icon('copy')}</button></dd></div>`;
      }).join('')}</dl>` : ''}
      ${d.tags?.length ? `<div class="tag-row">${d.tags.map(t => `<a class="tag" href="#/docs" data-tag-filter="${esc(t)}">#${esc(t)}</a>`).join('')}</div>` : ''}
      ${d.notes ? `<div class="notes"><h3>Observações</h3><p>${esc(d.notes)}</p></div>` : ''}
      <p class="meta-line muted small">${icon('lock')} Criado em ${new Date(d.createdAt).toLocaleDateString('pt-BR')} · ${files.length} anexo(s) · ${D.fmtBytes(files.reduce((s, f) => s + (f.size || 0), 0))} cifrados</p>
    </div>
    <footer class="sheet-foot view-actions">
      <button class="btn ghost danger-text" data-act="trash-doc">${icon('trash')}<span>Excluir</span></button>
      <button class="btn ghost" data-act="edit-doc">${icon('pencil')}<span>Editar</span></button>
      ${d.expiresAt ? `<button class="btn ghost" data-act="ics-doc">${icon('calendar')}<span>Agenda</span></button>` : ''}
      <button class="btn soft" data-act="share-doc">${icon('share')}<span>Compartilhar</span></button>
      ${files.length ? `<button class="btn primary" data-act="download-doc">${icon('download')}<span>Baixar</span></button>` : ''}
    </footer>`;
  openSheet('sheet-view');
  // Decifra imagens para a galeria
  for (const [i, f] of files.entries()) {
    if (!M.isImage(f.mime)) continue;
    try {
      const bytes = await V.readFile(d.id, f.id);
      if (state.viewId !== id) return;
      const url = URL.createObjectURL(new Blob([bytes], { type: f.mime }));
      state.urls.push(url);
      const slot = document.getElementById('g-' + i);
      if (slot) slot.innerHTML = `<img src="${url}" alt="">`;
    } catch { /* mantém ícone */ }
  }
}

async function openFile(i) {
  const d = findDoc(state.viewId), f = d?.files?.[i];
  if (!f) return;
  try {
    const bytes = await V.readFile(d.id, f.id);
    if (M.isImage(f.mime)) {
      const url = URL.createObjectURL(new Blob([bytes], { type: f.mime }));
      state.urls.push(url);
      state.viewer = { zoom: 1, rot: 0 };
      $('#viewer-name').textContent = f.label || f.name;
      $('#viewer-stage').innerHTML = `<img id="viewer-img" src="${url}" alt="${esc(f.name)}">`;
      $('.viewer-tools').hidden = false;
      openSheet('sheet-viewer');
    } else if (M.isPdf(f.mime, f.name) && !N.isNative() && !/Android|iPhone|iPad/i.test(navigator.userAgent)) {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      state.urls.push(url);
      $('#viewer-name').textContent = f.label || f.name;
      $('#viewer-stage').innerHTML = `<iframe src="${url}" title="${esc(f.name)}"></iframe>`;
      $('.viewer-tools').hidden = true;
      openSheet('sheet-viewer');
    } else {
      await N.openExternally(bytes, f.name, f.mime || 'application/octet-stream');
    }
  } catch (x) { toast('Não foi possível abrir: ' + x.message, 'error'); }
}
function applyViewer() {
  const img = $('#viewer-img');
  if (img) img.style.transform = `scale(${state.viewer.zoom}) rotate(${state.viewer.rot}deg)`;
  $('#viewer-stage').classList.toggle('zoomed', state.viewer.zoom > 1);
}

function docAsText(d) {
  const c = cat(d.category), p = person(d.personId);
  const lines = [`${d.title}`, `${c.name} · ${p.name}`, ''];
  for (const [, label, v] of detailRows(d)) lines.push(`${label}: ${v}`);
  if (d.notes) lines.push('', d.notes);
  return lines.join('\n');
}

async function chooseMenu(title, items) {
  return new Promise(resolve => {
    const card = $('#generic-card');
    card.innerHTML = `<header class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button></header>
      <div class="sheet-body menu">${items.map(([v, label, desc, ic]) => `<button class="setting" data-choice="${esc(v)}"><span class="s-icon">${icon(ic)}</span><span class="s-text"><strong>${esc(label)}</strong><small>${esc(desc)}</small></span>${icon('chevR')}</button>`).join('')}</div>`;
    const sheet = $('#sheet-generic');
    let chosen = null;
    const onClick = e => { const b = e.target.closest('[data-choice]'); if (b) { chosen = b.dataset.choice; closeSheet('sheet-generic'); } };
    card.addEventListener('click', onClick);
    sheet.addEventListener('sheetclose', () => { card.removeEventListener('click', onClick); resolve(chosen); }, { once: true });
    openSheet('sheet-generic');
  });
}

async function shareDoc(d) {
  const files = d.files || [];
  const choice = files.length ? await chooseMenu('Compartilhar', [
    ['file', files.length > 1 ? 'Primeiro anexo' : 'Arquivo', 'Envia o arquivo decifrado para outro app.', 'paperclip'],
    ...(files.length > 1 && !N.isNative() ? [['all', `Todos os ${files.length} anexos`, 'Frente, verso e páginas.', 'layers']] : []),
    ['text', 'Ficha com os dados', 'Número, datas e campos em texto.', 'text']
  ]) : 'text';
  if (!choice) return;
  try {
    if (choice === 'text') {
      const text = docAsText(d);
      if (!(await N.shareText(text, d.title))) await copyText(text, 'Ficha copiada para a área de transferência.');
      return;
    }
    const list = choice === 'all' ? files : [files[0]];
    const payload = [];
    for (const f of list) payload.push({ bytes: await V.readFile(d.id, f.id), name: f.name, mime: f.mime || 'application/octet-stream' });
    if (!(await N.shareFiles(payload, d.title))) {
      toast('Este navegador não compartilha arquivos; o download foi iniciado.', 'info');
      for (const f of payload) await N.saveFile(f.bytes, f.name, f.mime);
    }
  } catch (x) { toast('Falha ao compartilhar: ' + x.message, 'error'); }
}
async function downloadDoc(d) {
  const files = d.files || [];
  let list = files;
  if (files.length > 1) {
    const choice = await chooseMenu('Baixar', files.map((f, i) => [String(i), f.label || f.name, `${f.name} · ${D.fmtBytes(f.size)}`, M.fileKindIcon(f.mime, f.name)]).concat(N.isNative() ? [] : [['all', 'Todos', `${files.length} arquivos`, 'layers']]));
    if (choice === null) return;
    list = choice === 'all' ? files : [files[Number(choice)]];
  }
  try {
    for (const f of list) await N.saveFile(await V.readFile(d.id, f.id), f.name, f.mime || 'application/octet-stream');
    if (!N.isNative()) toast('Download iniciado. O arquivo salvo não fica cifrado.', 'info');
  } catch (x) { toast('Falha ao baixar: ' + x.message, 'error'); }
}

async function toggleFavorite(id) {
  const d = findDoc(id);
  if (!d) return;
  const next = { ...d, favorite: !d.favorite };
  await V.saveDocument(next);
  Object.assign(d, next);
  render();
  if (state.viewId === id && !$('#sheet-view').hidden) $$('#view-card [data-fav]').forEach(b => b.classList.toggle('on', d.favorite));
}
async function trashDoc(d) {
  const ok = await ask({ title: 'Mover para a lixeira?', message: `“${d.title}” poderá ser restaurado por ${state.settings.trashDays} dias.`, confirm: 'Mover para a lixeira', danger: true });
  if (!ok) return;
  const next = { ...d, deletedAt: new Date().toISOString() };
  await V.saveDocument(next);
  Object.assign(d, next);
  closeSheet('sheet-view');
  render();
  toast('Movido para a lixeira.');
}

// ------------------------------------------------------------------ agenda (.ics)
function icsFor(docs) {
  const pad = s => s.replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const ev = docs.filter(d => d.expiresAt).map(d => {
    const day = d.expiresAt.replace(/-/g, '');
    const next = new Date(Date.UTC(+d.expiresAt.slice(0, 4), +d.expiresAt.slice(5, 7) - 1, +d.expiresAt.slice(8, 10) + 1)).toISOString().slice(0, 10).replace(/-/g, '');
    return ['BEGIN:VEVENT', `UID:${d.id}@dossie.local`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${next}`,
      `SUMMARY:${pad('Vence: ' + d.title)}`, `DESCRIPTION:${pad(`${cat(d.category).name} · ${person(d.personId).name}. Lembrete criado pelo Dossiê.`)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${pad('Vence em breve: ' + d.title)}`, `TRIGGER:-P${state.settings.warnDays}D`, 'END:VALARM',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${pad('Vence amanhã: ' + d.title)}`, 'TRIGGER:-P1D', 'END:VALARM', 'END:VEVENT'].join('\r\n');
  });
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dossie//Vencimentos//PT-BR', 'CALSCALE:GREGORIAN', ...ev, 'END:VCALENDAR'].join('\r\n') + '\r\n';
}
async function exportIcs(docs, name) {
  const list = docs.filter(d => d.expiresAt);
  if (!list.length) return toast('Nenhum documento com validade.', 'info');
  await N.saveFile(new TextEncoder().encode(icsFor(list)), name, 'text/calendar');
  toast(`${list.length} lembrete(s) exportado(s). Abra o arquivo na sua agenda.`);
}

// ------------------------------------------------------------------ notificações
async function maybeNotify() {
  const st = state.settings;
  if (!st.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  const today = D.todayISO();
  if (st.lastNotifiedOn === today) return;
  const all = live();
  const expired = all.filter(d => status(d).key === 'expired').length;
  const soon = all.filter(d => status(d).key === 'soon').length;
  if (!expired && !soon) return;
  const body = [expired && `${expired} vencido(s)`, soon && `${soon} vencendo em até ${st.warnDays} dias`].filter(Boolean).join(' · ');
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg) await reg.showNotification('Dossiê: prazos de documentos', { body, icon: 'assets/icon-192.png', tag: 'dossie-expiry' });
    else new Notification('Dossiê: prazos de documentos', { body });
    st.lastNotifiedOn = today;
    await persistSettings();
  } catch { /* opcional */ }
}

// ================================================================== CHAVE DE RECUPERAÇÃO
function showRecoveryCode(code, first = false) {
  const card = $('#generic-card');
  card.innerHTML = `
    <header class="sheet-head"><div><p class="eyebrow">Guarde em local seguro</p><h2>Sua chave de recuperação</h2></div>${first ? '' : `<button class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button>`}</header>
    <div class="sheet-body stack">
      <p class="muted">Se esquecer a senha, só esta chave abre o cofre. Ela não fica salva em lugar nenhum além daqui — anote no papel ou guarde no seu gerenciador de senhas.</p>
      <div class="recovery-code" aria-label="Chave de recuperação">${code.split('-').map(g => `<span>${g}</span>`).join('')}</div>
      <div class="row gap"><button class="btn soft" data-copy="${esc(code)}">${icon('copy')} Copiar</button><button class="btn soft" data-act="save-recovery" data-code="${esc(code)}">${icon('download')} Salvar .txt</button></div>
      <label class="check"><input type="checkbox" id="rc-ok"> Guardei a chave em um lugar seguro</label>
    </div>
    <footer class="sheet-foot"><button class="btn primary" id="rc-done" disabled data-close>${icon('check')} Concluir</button></footer>`;
  $('#rc-ok').addEventListener('change', e => { $('#rc-done').disabled = !e.target.checked; });
  card.parentElement.dataset.locked = first ? '1' : '';
  openSheet('sheet-generic');
}

// ================================================================== PESSOAS E CATEGORIAS
function editPersonSheet(p = null) {
  const card = $('#generic-card');
  const color = p?.color || D.PALETTE[people().length % D.PALETTE.length];
  card.innerHTML = `
    <header class="sheet-head"><h2>${p ? 'Editar pessoa' : 'Nova pessoa'}</h2><button class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button></header>
    <form class="sheet-body stack" id="person-form">
      <label class="field"><span>Nome</span><input id="p-name" maxlength="40" required value="${esc(p?.name || '')}" placeholder="Ex.: Ana, Pai, Filho"></label>
      <div class="field"><span>Cor</span><div class="swatches">${D.PALETTE.map(c => `<label class="swatch" style="--c:${c}"><input type="radio" name="p-color" value="${c}" ${c === color ? 'checked' : ''}><i></i></label>`).join('')}</div></div>
      <div class="row gap end">
        ${p && p.id !== 'me' ? `<button type="button" class="btn ghost danger-text" data-act="delete-person" data-id="${esc(p.id)}">${icon('trash')} Remover</button>` : ''}
        <button class="btn primary">${icon('check')} Salvar</button>
      </div>
    </form>`;
  $('#person-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('#p-name').value.trim();
    if (!name) return;
    const col = $('input[name=p-color]:checked', card)?.value || color;
    if (p) Object.assign(state.settings.people.find(x => x.id === p.id), { name, color: col });
    else state.settings.people.push({ id: uid(), name, color: col });
    await persistSettings();
    closeSheet('sheet-generic');
    render();
    toast(p ? 'Pessoa atualizada.' : 'Pessoa adicionada.');
  });
  openSheet('sheet-generic');
}
function managePeople() {
  const card = $('#generic-card');
  card.innerHTML = `
    <header class="sheet-head"><h2>Pessoas</h2><button class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button></header>
    <div class="sheet-body menu">
      ${people().map(p => `<button class="setting" data-act="edit-person" data-id="${esc(p.id)}"><span class="s-icon" style="--c:${esc(p.color)}"><i class="dot big" style="--c:${esc(p.color)}"></i></span><span class="s-text"><strong>${esc(p.name)}</strong><small>${live().filter(d => d.personId === p.id).length} documento(s)</small></span>${icon('pencil')}</button>`).join('')}
      <button class="btn soft block" data-act="new-person">${icon('plus')} Adicionar pessoa</button>
    </div>`;
  openSheet('sheet-generic');
}
async function deletePerson(id) {
  const p = person(id);
  const n = live().filter(d => d.personId === id).length;
  const ok = await ask({ title: `Remover ${p.name}?`, message: n ? `${n} documento(s) passarão para “${people()[0].name}”.` : 'Nenhum documento será afetado.', confirm: 'Remover', danger: true });
  if (!ok) return;
  const target = people()[0].id;
  for (const d of state.docs.filter(x => x.personId === id)) { d.personId = target; await V.saveDocument(d); }
  state.settings.people = state.settings.people.filter(x => x.id !== id);
  await persistSettings();
  closeSheet('sheet-generic');
  if (state.route.name === 'person' && state.route.param === id) go('#/'); else render();
}

function editCategorySheet(c = null) {
  const card = $('#generic-card');
  const color = c?.color || D.PALETTE[(state.settings.customCategories.length + 3) % D.PALETTE.length];
  const ic = c?.icon || 'folder';
  card.innerHTML = `
    <header class="sheet-head"><h2>${c ? 'Editar categoria' : 'Nova categoria'}</h2><button class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button></header>
    <form class="sheet-body stack" id="cat-form">
      <label class="field"><span>Nome</span><input id="c-name" maxlength="32" required value="${esc(c?.name || '')}" placeholder="Ex.: Pets, Imóveis, Viagens"></label>
      <label class="field"><span>Descrição curta</span><input id="c-hint" maxlength="60" value="${esc(c?.hint || '')}" placeholder="Opcional"></label>
      <label class="field"><span>Rótulo do número</span><input id="c-numlabel" maxlength="40" value="${esc(c?.numberLabel || 'Número')}"></label>
      <label class="field"><span>Campos extras (separados por vírgula)</span><input id="c-fields" maxlength="300" value="${esc((c?.fields || []).map(f => f[1]).join(', '))}" placeholder="Ex.: Microchip, Veterinário, Raça"></label>
      <div class="field"><span>Ícone</span><div class="icon-pick">${D.CUSTOM_ICONS.filter(n => ICON_NAMES.includes(n)).map(n => `<label><input type="radio" name="c-icon" value="${n}" ${n === ic ? 'checked' : ''}><i>${icon(n)}</i></label>`).join('')}</div></div>
      <div class="field"><span>Cor</span><div class="swatches">${D.PALETTE.map(x => `<label class="swatch" style="--c:${x}"><input type="radio" name="c-color" value="${x}" ${x === color ? 'checked' : ''}><i></i></label>`).join('')}</div></div>
      <div class="row gap end">
        ${c ? `<button type="button" class="btn ghost danger-text" data-act="delete-category" data-id="${esc(c.id)}">${icon('trash')} Excluir</button>` : ''}
        <button class="btn primary">${icon('check')} Salvar</button>
      </div>
    </form>`;
  $('#cat-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('#c-name').value.trim();
    if (!name) return;
    const labels = $('#c-fields').value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 12);
    const oldFields = c?.fields || [];
    const fields = labels.map((label, i) => [oldFields.find(f => f[1] === label)?.[0] || `campo_${Date.now().toString(36)}_${i}`, label]);
    const data = { name, hint: $('#c-hint').value.trim(), numberLabel: $('#c-numlabel').value.trim() || 'Número', fields,
      icon: $('input[name=c-icon]:checked', card)?.value || ic, color: $('input[name=c-color]:checked', card)?.value || color, custom: true };
    if (c) Object.assign(state.settings.customCategories.find(x => x.id === c.id), data);
    else state.settings.customCategories.push({ id: 'c-' + uid().slice(0, 8), ...data });
    await persistSettings();
    closeSheet('sheet-generic');
    render();
    toast(c ? 'Categoria atualizada.' : 'Categoria criada.');
  });
  openSheet('sheet-generic');
}
async function deleteCategory(id) {
  const c = cat(id);
  const n = state.docs.filter(d => d.category === id).length;
  const ok = await ask({ title: `Excluir “${c.name}”?`, message: n ? `${n} documento(s) irão para “Outros”.` : 'A categoria está vazia.', confirm: 'Excluir', danger: true });
  if (!ok) return;
  for (const d of state.docs.filter(x => x.category === id)) { d.category = 'outros'; await V.saveDocument(d); }
  state.settings.customCategories = state.settings.customCategories.filter(x => x.id !== id);
  await persistSettings();
  closeSheet('sheet-generic');
  if (state.route.name === 'cat') go('#/docs'); else render();
}

// ================================================================== BACKUP
async function doBackup() {
  try {
    toast('Preparando backup…', 'info', 1500);
    const blob = await B.buildBackupBlob();
    await N.saveBlob(blob, B.backupFileName());
    state.settings.lastBackupAt = new Date().toISOString();
    await persistSettings();
    if (!N.isNative()) toast('Backup salvo. Ele só abre com a sua senha atual.');
    render();
  } catch (x) { toast('Falha no backup: ' + x.message, 'error'); }
}

function progress(text) {
  const host = $('#dialog');
  host.hidden = false;
  host.innerHTML = `<div class="dialog-backdrop"></div><div class="dialog-card"><div class="spinner big"></div><p id="prog-text">${esc(text)}</p></div>`;
  return { set: t => { const el = $('#prog-text'); if (el) el.textContent = t; }, done: () => { host.hidden = true; host.innerHTML = ''; } };
}

/** fromAuth: restauração a partir da tela de bloqueio (cria/substitui o cofre). */
async function restoreBackup(file, fromAuth) {
  let parsed;
  try {
    if (file.size > 800 * 1024 * 1024) throw new Error('Arquivo grande demais.');
    parsed = B.parseBackup(await file.text());
  } catch (x) { return toast(x.message, 'error'); }
  const label = parsed.kind === 'v1' ? 'Backup do Dossiê 1.x' : 'Backup do Dossiê';
  const password = await ask({ title: 'Senha do backup', message: `${label} com ${parsed.count} documento(s). Digite a senha usada quando ele foi criado.`, input: 'password', confirm: 'Abrir backup' });
  if (!password) return;
  let reader, prog = progress('Verificando senha…');
  try { reader = await B.openBackup(parsed, password); }
  catch (x) { prog.done(); return toast(x.message, 'error'); }
  prog.done();

  let mode = 'merge';
  if (fromAuth) {
    const exists = !!(await V.getVaultRecord());
    if (exists) {
      const ok = await ask({ title: 'Substituir o cofre deste aparelho?', message: 'Todos os documentos atuais serão apagados e o cofre passará a usar a senha do backup.', confirm: 'Substituir', danger: true, input: 'text', placeholder: 'Digite SUBSTITUIR', expect: 'SUBSTITUIR' });
      if (!ok) return;
      await V.wipe();
      N.disableBiometric();
    }
  } else {
    mode = await chooseMenu('Como importar?', [
      ['merge', 'Mesclar', 'Adiciona os documentos do backup aos que já existem.', 'layers'],
      ['replace', 'Substituir', 'Apaga os documentos atuais e mantém sua senha atual.', 'restore']
    ]);
    if (!mode) return;
    if (mode === 'replace') {
      const ok = await ask({ title: 'Substituir documentos?', message: 'Os documentos atuais serão apagados deste aparelho.', confirm: 'Substituir', danger: true });
      if (!ok) return;
    }
  }

  prog = progress('Importando…');
  try {
    let code = null;
    if (fromAuth) {
      code = await V.createVault(password);
      state.settings = await V.loadSettings();
      state.docs = [];
    } else if (mode === 'replace') {
      await S.clearDocuments();
      state.docs = [];
    }
    // Configurações: pessoas e categorias personalizadas
    if (reader.settings) {
      const s = state.settings;
      for (const p of reader.settings.people || []) if (!s.people.some(x => x.id === p.id)) s.people.push(p);
      for (const c of reader.settings.customCategories || []) if (!s.customCategories.some(x => x.id === c.id)) s.customCategories.push(c);
      if (fromAuth) for (const k of ['warnDays', 'autoLockMinutes', 'trashDays', 'privacy', 'blurThumbs', 'lockOnHide']) if (k in reader.settings) s[k] = reader.settings[k];
      await persistSettings();
    }
    const existing = new Map(state.docs.map(d => [d.id, d]));
    const personIds = new Set(state.settings.people.map(p => p.id));
    let n = 0, skipped = 0;
    for await (const { meta, files } of reader.documents()) {
      let id = meta.id;
      const cur = existing.get(id);
      if (cur) { if (cur.updatedAt === meta.updatedAt) { skipped++; continue; } id = uid(); }
      const mapped = files.map(f => ({ meta: { ...f.meta, id: uid() }, bytes: f.bytes, old: f.meta.id }));
      const doc = {
        ...meta, id,
        personId: personIds.has(meta.personId) ? meta.personId : state.settings.people[0].id,
        category: categories().some(c => c.id === meta.category) ? meta.category : 'outros',
        files: mapped.map(f => f.meta),
        coverId: mapped.find(f => f.old === meta.coverId)?.meta.id ?? null
      };
      await V.saveDocument(doc, mapped);
      state.docs.push(doc);
      prog.set(`Importando… ${++n} de ${parsed.count}`);
    }
    prog.done();
    if (fromAuth) { await enterApp(); showRecoveryCode(code, true); }
    else render();
    toast(`${n} documento(s) importado(s)${skipped ? `, ${skipped} já existia(m)` : ''}.`);
  } catch (x) {
    prog.done();
    console.error(x);
    toast('Falha na importação: ' + x.message, 'error');
  }
}

// ================================================================== AÇÕES
async function act(name, el) {
  const d = findDoc(state.viewId);
  switch (name) {
    case 'new': return openEditor();
    case 'lock': return lockApp();
    case 'toggle-search': document.body.classList.toggle('search-open'); $('#global-search').focus(); return;
    case 'privacy':
      state.settings.privacy = !state.settings.privacy; state.revealed.clear();
      document.body.classList.toggle('privacy', state.settings.privacy);
      await persistSettings(); render();
      if (d && !$('#sheet-view').hidden) openView(d.id);
      return toast(state.settings.privacy ? 'Números ocultos.' : 'Números visíveis.', 'info', 1800);
    case 'clear-filters': state.filters = { cat: '', person: '', tag: '', status: '' }; state.query = ''; $('#global-search').value = ''; return render();
    case 'edit-doc': closeSheet('sheet-view'); return openEditor(d);
    case 'trash-doc': return trashDoc(d);
    case 'share-doc': return shareDoc(d);
    case 'download-doc': return downloadDoc(d);
    case 'ics-doc': return exportIcs([d], `vencimento-${D.todayISO()}.ics`);
    case 'ics-all': return exportIcs(live(), `dossie-vencimentos-${D.todayISO()}.ics`);
    case 'viewer-zoom': state.viewer.zoom = state.viewer.zoom >= 3 ? 1 : state.viewer.zoom + 1; return applyViewer();
    case 'viewer-rotate': state.viewer.rot = (state.viewer.rot + 90) % 360; return applyViewer();
    case 'restore-doc': {
      const t = findDoc(el.dataset.id); t.deletedAt = null; await V.saveDocument(t); render(); return toast('Documento restaurado.');
    }
    case 'purge-doc': {
      const t = findDoc(el.dataset.id);
      if (!(await ask({ title: 'Apagar definitivamente?', message: `“${t.title}” e seus anexos serão destruídos.`, confirm: 'Apagar', danger: true }))) return;
      await V.purgeDocument(t.id); state.docs = state.docs.filter(x => x !== t); render(); return toast('Apagado.');
    }
    case 'empty-trash': {
      const items = state.docs.filter(x => x.deletedAt);
      if (!(await ask({ title: 'Esvaziar a lixeira?', message: `${items.length} documento(s) serão apagados para sempre.`, confirm: 'Esvaziar', danger: true }))) return;
      for (const t of items) await V.purgeDocument(t.id);
      state.docs = state.docs.filter(x => !x.deletedAt); render(); return toast('Lixeira esvaziada.');
    }
    case 'new-person': return editPersonSheet();
    case 'edit-person': return editPersonSheet(person(el.dataset.id));
    case 'delete-person': return deletePerson(el.dataset.id);
    case 'manage-people': return managePeople();
    case 'new-category': return editCategorySheet();
    case 'edit-category': return editCategorySheet(cat(el.dataset.id));
    case 'delete-category': return deleteCategory(el.dataset.id);
    case 'backup': return doBackup();
    case 'restore': $('#restore-input').dataset.fromAuth = ''; return $('#restore-input').click();
    case 'save-recovery': return N.saveFile(new TextEncoder().encode(`Dossiê — chave de recuperação\n\n${el.dataset.code}\n\nGuarde este arquivo fora do celular (papel, gerenciador de senhas).\n`), 'dossie-chave-de-recuperacao.txt', 'text/plain');
    case 'change-password': {
      const cur = await ask({ title: 'Senha atual', input: 'password', confirm: 'Continuar' });
      if (!cur) return;
      const next = await ask({ title: 'Nova senha', message: 'Mínimo de 8 caracteres.', input: 'password', confirm: 'Continuar' });
      if (!next) return;
      if (next.length < 8) return toast('A nova senha precisa de 8 caracteres ou mais.', 'error');
      const again = await ask({ title: 'Confirme a nova senha', input: 'password', confirm: 'Alterar senha' });
      if (again !== next) return toast('As senhas não coincidem.', 'error');
      try { await V.changePassword(cur, next); toast('Senha alterada. Backups antigos continuam usando a senha antiga.', 'ok', 6000); }
      catch (x) { toast(x.message, 'error'); }
      return;
    }
    case 'new-recovery': {
      const pw = await ask({ title: 'Confirme sua senha', message: 'A chave de recuperação anterior deixará de funcionar.', input: 'password', confirm: 'Gerar nova chave' });
      if (!pw) return;
      try {
        const code = await V.regenerateRecovery(pw);
        state.settings.hasRecovery = true; await persistSettings();
        showRecoveryCode(code);
      } catch (x) { toast(x.message, 'error'); }
      return;
    }
    case 'toggle-bio': {
      if (N.biometricEnabled()) { N.disableBiometric(); return; }
      const pw = await ask({ title: 'Confirme sua senha', message: 'Para ativar o desbloqueio com digital ou PIN.', input: 'password', confirm: 'Ativar' });
      if (!pw) return;
      try { const raw = await V.exportRawKey(pw); N.enableBiometric(raw); raw.fill(0); }
      catch (x) { toast(x.message, 'error'); }
      return;
    }
    case 'toggle-lockhide': state.settings.lockOnHide = !state.settings.lockOnHide; await persistSettings(); return render();
    case 'toggle-secure': state.settings.secureScreen = !state.settings.secureScreen; N.setSecureScreen(state.settings.secureScreen); await persistSettings(); return render();
    case 'toggle-blur': state.settings.blurThumbs = !state.settings.blurThumbs; document.body.classList.toggle('blur-thumbs', state.settings.blurThumbs); await persistSettings(); return render();
    case 'toggle-notify': {
      if (state.settings.notify && Notification.permission === 'granted') state.settings.notify = false;
      else {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') return toast('Permissão de notificação negada pelo navegador.', 'error');
        state.settings.notify = true; state.settings.lastNotifiedOn = null;
      }
      await persistSettings(); render(); return maybeNotify();
    }
    case 'wipe': {
      const ok = await ask({ title: 'Apagar tudo?', message: 'Todos os documentos, a senha e as configurações deste aparelho serão destruídos.', input: 'text', placeholder: 'Digite APAGAR', expect: 'APAGAR', confirm: 'Apagar tudo', danger: true });
      if (!ok) return;
      await V.wipe(); N.disableBiometric();
      state.docs = []; state.settings = null; closeAllSheets();
      location.hash = '#/';
      showAuth('setup');
      return toast('Dados apagados.');
    }
  }
}

// ================================================================== EVENTOS
function bind() {
  document.addEventListener('click', async e => {
    const t = e.target;
    const reveal = t.closest('[data-reveal]');
    if (reveal) { const inp = document.getElementById(reveal.dataset.reveal); inp.type = inp.type === 'password' ? 'text' : 'password'; reveal.innerHTML = icon(inp.type === 'password' ? 'eye' : 'eyeOff'); return; }
    const auth = t.closest('[data-auth]');
    if (auth) {
      const a = auth.dataset.auth;
      if (a === 'bio') return N.requestBiometric();
      if (a === 'restore') { $('#restore-input').dataset.fromAuth = '1'; return $('#restore-input').click(); }
      return showAuth(a);
    }
    if (!V.isUnlocked() && !t.closest('#dialog')) return;
    const close = t.closest('[data-close]');
    if (close) { const sheet = close.closest('.sheet'); if (sheet && !(sheet.dataset.locked && close.classList.contains('sheet-backdrop'))) closeSheet(sheet.id); return; }
    const copy = t.closest('[data-copy]'); if (copy) return copyText(copy.dataset.copy);
    const fav = t.closest('[data-fav]'); if (fav) { e.stopPropagation(); return toggleFavorite(fav.dataset.fav); }
    const tpl = t.closest('[data-template]'); if (tpl) return openEditor(null, tpl.dataset.template);
    const tagF = t.closest('[data-tag-filter]');
    if (tagF) { e.preventDefault(); closeSheet('sheet-view'); go('#/docs'); state.filters.tag = tagF.dataset.tagFilter; return render(); }
    const open = t.closest('[data-open]'); if (open) return openView(open.dataset.open);
    const file = t.closest('[data-file]'); if (file) return openFile(Number(file.dataset.file));
    const layout = t.closest('[data-layout]'); if (layout) { state.layout = layout.dataset.layout; setPref('layout', state.layout); return render(); }
    const theme = t.closest('[data-theme-set]'); if (theme) { setPref('theme', theme.dataset.themeSet); applyTheme(); return render(); }
    const rf = t.closest('[data-reveal-field]');
    if (rf) { const key = state.viewId + rf.dataset.revealField; state.revealed.has(key) ? state.revealed.delete(key) : state.revealed.add(key); return openView(state.viewId); }
    const sens = t.closest('body.privacy .sensitive');
    if (sens && !sens.closest('[data-open]')) { sens.classList.toggle('shown'); return; }
    // editor
    const untag = t.closest('[data-untag]'); if (untag) { state.edit.tags = state.edit.tags.filter(x => x !== untag.dataset.untag); return renderTags(); }
    const years = t.closest('[data-years]');
    if (years) {
      const y = Number(years.dataset.years);
      if (!y) { $('#f-expires').value = ''; return; }
      const base = $('#f-issued').value || D.todayISO();
      const [yy, mm, dd] = base.split('-').map(Number);
      const dt = new Date(Date.UTC(yy + y, mm - 1, dd));
      $('#f-expires').value = dt.toISOString().slice(0, 10);
      return;
    }
    const cover = t.closest('[data-cover]'); if (cover) { state.edit.coverId = state.edit.files[Number(cover.dataset.cover)].meta.id; return renderAttachments(); }
    const move = t.closest('[data-move]');
    if (move) { const i = Number(move.dataset.move), f = state.edit.files; [f[i - 1], f[i]] = [f[i], f[i - 1]]; return renderAttachments(); }
    const rm = t.closest('[data-remove-file]');
    if (rm) {
      const [item] = state.edit.files.splice(Number(rm.dataset.removeFile), 1);
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      if (!item.bytes) state.edit.removed.push(item.meta.id);
      return renderAttachments();
    }
    const a = t.closest('[data-act]'); if (a) { e.preventDefault(); return act(a.dataset.act, a); }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('[data-open], [data-open] *') && e.target.closest('[data-open]') === e.target) { e.preventDefault(); return openView(e.target.dataset.open); }
    if (e.key === 'Escape') {
      if (dialogOpen()) return;
      const top = topSheet();
      if (top && !$('#' + top).dataset.locked) { closeSheet(top); return; }
      if (document.body.classList.contains('search-open')) document.body.classList.remove('search-open');
      return;
    }
    if (!V.isUnlocked() || topSheet() || dialogOpen()) return;
    if (e.target.matches('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#global-search').focus(); }
      return;
    }
    const k = e.key.toLowerCase();
    if (k === '/') { e.preventDefault(); document.body.classList.add('search-open'); $('#global-search').focus(); }
    else if (k === 'n') { e.preventDefault(); openEditor(); }
    else if (k === 'l') lockApp();
    else if (k === 'p') act('privacy');
  });

  $('#global-search').addEventListener('input', e => {
    state.query = e.target.value;
    if (!['docs', 'favorites', 'cat', 'person'].includes(state.route.name)) { const q = state.query; go('#/docs'); state.query = q; }
    refreshResults();
  });
  document.addEventListener('change', async e => {
    const t = e.target;
    if (t.matches('[data-filter]')) { state.filters[t.dataset.filter] = t.value; return render(); }
    if (t.id === 'sort') { state.sort = t.value; setPref('sort', t.value); return render(); }
    if (t.matches('[data-setting]')) { state.settings[t.dataset.setting] = Number(t.value); await persistSettings(); armIdle(); render(); return toast('Ajuste salvo.', 'ok', 1500); }
    if (t.id === 'f-category') return renderDetails(t.value);
    if (t.id === 'file-input' || t.id === 'camera-input') { await addFiles([...t.files]); t.value = ''; return; }
    if (t.id === 'restore-input') { const f = t.files[0]; t.value = ''; if (f) restoreBackup(f, t.dataset.fromAuth === '1'); }
  });
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'f-number') return validateNumber();
    if (t.matches('[data-label]')) { state.edit.files[Number(t.dataset.label)].meta.label = t.value.trim(); return; }
    if (t.matches('[data-type="cpf"]')) {
      t.value = D.formatCPF(t.value);
      const h = t.parentElement.querySelector('.hint'), full = D.onlyDigits(t.value).length === 11;
      h.textContent = full ? (D.isValidCPF(t.value) ? '✓ CPF válido' : 'CPF inválido') : ''; h.className = 'hint ' + (full ? (D.isValidCPF(t.value) ? 'ok' : 'bad') : '');
    }
    if (t.matches('[data-type="plate"]')) t.value = D.formatPlate(t.value);
  });
  $('#f-tag').addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(e.target.value); e.target.value = ''; }
    else if (e.key === 'Backspace' && !e.target.value && state.edit.tags.length) { state.edit.tags.pop(); renderTags(); }
  });
  $('#f-tag').addEventListener('change', e => { if (e.target.value.trim()) { addTag(e.target.value); e.target.value = ''; } });
  $('#edit-form').addEventListener('submit', saveEditor);
  $('#sheet-edit').addEventListener('sheetclose', () => { if (V.isUnlocked()) { releaseEditUrls(); state.edit = null; } });
  $('#sheet-view').addEventListener('sheetclose', () => { if (topSheet() !== 'sheet-viewer') { releaseUrls(); state.viewId = null; } });
  $('#sheet-generic').addEventListener('sheetclose', () => { $('#sheet-generic').dataset.locked = ''; });

  const drop = $('#attach-zone');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('drag'); addFiles([...e.dataTransfer.files]); });
  document.addEventListener('paste', e => {
    if (!state.edit || $('#sheet-edit').hidden) return;
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addFiles(files); }
  });

  // atividade / bloqueio
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) document.addEventListener(ev, activity, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { state.hiddenAt = Date.now(); return; }
    if (!V.isUnlocked()) {
      if (N.biometricEnabled() && !$('#auth').hidden && $('[data-auth="bio"]')) setTimeout(() => !V.isUnlocked() && N.requestBiometric(), 350);
      return;
    }
    const away = Date.now() - (state.hiddenAt || Date.now());
    const min = Number(state.settings.autoLockMinutes || 0);
    if (state.settings.lockOnHide && away > 30_000) return lockApp('Cofre bloqueado ao voltar para o app.');
    if (min && Date.now() - state.lastActivity > min * 60_000) return lockApp('Cofre bloqueado por inatividade.');
  });
  window.addEventListener('hashchange', route);

  // ponte nativa
  N.onNativeEvent(async (type, payload) => {
    if (type === 'biometric-secret') {
      try { await V.unlockWithRawKey(payload); await enterApp(); }
      catch { toast('A chave biométrica não confere mais. Use a senha e reative nos Ajustes.', 'error'); N.disableBiometric(); showAuth('login'); }
    } else if (type === 'biometric-enabled') { toast('Desbloqueio biométrico ativado.'); if (V.isUnlocked()) render(); }
    else if (type === 'biometric-disabled') { toast('Desbloqueio biométrico desativado.', 'info'); if (V.isUnlocked()) render(); }
    else if (type === 'biometric-invalidated') { toast('As biometrias do aparelho mudaram. Entre com a senha e reative.', 'error'); showAuth('login'); }
    else if (type === 'biometric-error') toast(payload || 'Não foi possível usar a biometria.', 'error');
    else if (type === 'saved') toast('Arquivo salvo.');
    else if (type === 'transfer-error') toast(payload || 'Falha ao transferir arquivo.', 'error');
  });
  window.dossieHandleBack = () => {
    if (dialogOpen()) { cancelDialog(); return true; }
    const top = topSheet();
    if (top) { if (!$('#' + top).dataset.locked) closeSheet(top); return true; }
    if (V.isUnlocked() && state.route.name !== 'home') { history.back(); return true; }
    return false;
  };
}

// ================================================================== INÍCIO
async function init() {
  applyTheme();
  hydrateIcons();
  bind();
  try {
    if (!window.isSecureContext || !crypto?.subtle || !window.indexedDB) throw new Error('Abra o Dossiê por HTTPS (ou localhost) em um navegador atualizado.');
    await S.openStore();
    await showAuth();
    if (!N.isNative() && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  } catch (x) {
    $('#auth-panel').innerHTML = `<h2>Não foi possível iniciar</h2><p class="muted">${esc(x.message)} Verifique se a navegação privada está desativada e se o armazenamento local é permitido.</p>`;
  }
}
init();
