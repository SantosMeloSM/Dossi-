// Cofre: gerenciamento de chaves e leitura/escrita de documentos cifrados.
//
// Modelo de chaves
//   DEK (chave de dados, AES-256 aleatória) cifra metadados e arquivos.
//   A DEK é "embrulhada" por:
//     • KEK derivada da senha (PBKDF2-SHA256, 310 mil iterações)
//     • KEK derivada da chave de recuperação (opcional)
//     • chave do Android Keystore (desbloqueio biométrico, no app nativo)
//   Trocar a senha só reembrulha a DEK; nada precisa ser recifrado.
//   Metadados e arquivos usam AAD com o id do registro, impedindo troca de blocos.
import * as C from './crypto.js';
import * as S from './store.js';

const VAULT_ID = 'vault';
const SETTINGS_ID = 'settings';
const SETTINGS_AAD = 'dossie:settings';

let dek = null; // CryptoKey não extraível
export const isUnlocked = () => !!dek;

export const DEFAULT_SETTINGS = {
  people: [{ id: 'me', name: 'Eu', color: '#4f8df7' }],
  customCategories: [],
  autoLockMinutes: 10,
  lockOnHide: false,
  warnDays: 30,
  notify: false,
  privacy: false,
  blurThumbs: false,
  secureScreen: true,
  trashDays: 30,
  lastBackupAt: null,
  lastNotifiedOn: null,
  hasRecovery: false,
  createdAt: null
};

export const getVaultRecord = () => S.get('meta', VAULT_ID);

async function wrap(secret, raw) {
  const salt = C.rand(16);
  const kek = await C.deriveKek(secret, salt);
  const box = await C.seal(kek, raw, 'dossie:dek');
  return { salt, iterations: C.PBKDF2_ITERATIONS, iv: box.iv, ct: box.ct };
}
async function unwrap(secret, w) {
  const kek = await C.deriveKek(secret, w.salt, w.iterations);
  return C.unseal(kek, w, 'dossie:dek');
}

export async function createVault(password) {
  const raw = C.rand(32);
  const recovery = C.newRecoveryCode();
  const record = {
    id: VAULT_ID, version: 2,
    pw: await wrap(password, raw),
    rec: await wrap(C.normalizeRecoveryCode(recovery), raw),
    failed: 0, lockedUntil: 0
  };
  dek = await C.importAesKey(raw);
  raw.fill(0);
  await S.put('meta', record);
  await saveSettings({ ...DEFAULT_SETTINGS, hasRecovery: true, createdAt: new Date().toISOString() });
  return recovery;
}

/** Retorna o tempo restante de bloqueio por tentativas (ms). */
export async function throttleRemaining() {
  const v = await getVaultRecord();
  return v ? Math.max(0, (v.lockedUntil || 0) - Date.now()) : 0;
}

async function registerFailure() {
  const v = await getVaultRecord();
  v.failed = (v.failed || 0) + 1;
  if (v.failed >= 5) v.lockedUntil = Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** (v.failed - 5));
  await S.put('meta', v);
  return v;
}
async function clearFailures(v) {
  if (v.failed || v.lockedUntil) { v.failed = 0; v.lockedUntil = 0; await S.put('meta', v); }
}

export async function unlockWithPassword(password) {
  const v = await getVaultRecord();
  if (!v) throw new Error('Cofre não encontrado.');
  if ((v.lockedUntil || 0) > Date.now()) throw new Error('Muitas tentativas. Aguarde um pouco.');
  let raw;
  try { raw = await unwrap(password, v.pw); }
  catch {
    const after = await registerFailure();
    const left = Math.max(0, 5 - after.failed);
    throw new Error(left ? `Senha incorreta. ${left} tentativa(s) antes de uma pausa.` : 'Senha incorreta. Aguarde antes de tentar de novo.');
  }
  dek = await C.importAesKey(raw);
  raw.fill(0);
  await clearFailures(v);
}

/** Desbloqueia com a chave de recuperação e define uma nova senha. */
export async function recoverAndReset(code, newPassword) {
  const v = await getVaultRecord();
  if (!v?.rec) throw new Error('Este cofre não possui chave de recuperação.');
  if ((v.lockedUntil || 0) > Date.now()) throw new Error('Muitas tentativas. Aguarde um pouco.');
  let raw;
  try { raw = await unwrap(C.normalizeRecoveryCode(code), v.rec); }
  catch { await registerFailure(); throw new Error('Chave de recuperação inválida.'); }
  v.pw = await wrap(newPassword, raw);
  v.failed = 0; v.lockedUntil = 0;
  await S.put('meta', v);
  dek = await C.importAesKey(raw);
  raw.fill(0);
}

/** Desbloqueio com segredo vindo do Keystore (DEK bruta em base64). */
export async function unlockWithRawKey(b64) {
  const raw = C.fromB64(b64);
  const key = await C.importAesKey(raw);
  raw.fill(0);
  const rec = await S.get('meta', SETTINGS_ID);
  await C.unseal(key, rec, SETTINGS_AAD); // valida
  dek = key;
}

/** Confirma a senha e devolve a DEK bruta (para o Keystore). O chamador deve zerar o array. */
export async function exportRawKey(password) {
  const v = await getVaultRecord();
  try { return await unwrap(password, v.pw); }
  catch { throw new Error('Senha incorreta.'); }
}

export async function changePassword(current, next) {
  const v = await getVaultRecord();
  let raw;
  try { raw = await unwrap(current, v.pw); } catch { throw new Error('Senha atual incorreta.'); }
  v.pw = await wrap(next, raw);
  raw.fill(0);
  await S.put('meta', v);
}

export async function regenerateRecovery(password) {
  const v = await getVaultRecord();
  let raw;
  try { raw = await unwrap(password, v.pw); } catch { throw new Error('Senha incorreta.'); }
  const code = C.newRecoveryCode();
  v.rec = await wrap(C.normalizeRecoveryCode(code), raw);
  raw.fill(0);
  await S.put('meta', v);
  return code;
}

export function lock() { dek = null; }

// ---------- configurações (cifradas) ----------
export async function loadSettings() {
  const rec = await S.get('meta', SETTINGS_ID);
  if (!rec) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...(await C.unsealJson(dek, rec, SETTINGS_AAD)) };
}
export async function saveSettings(settings) {
  const box = await C.sealJson(dek, settings, SETTINGS_AAD);
  await S.put('meta', { id: SETTINGS_ID, ...box });
}

// ---------- documentos ----------
const metaAad = id => 'dossie:doc:' + id;
const blobAad = (docId, id) => `dossie:file:${docId}:${id}`;

export async function loadDocuments() {
  const rows = await S.getAll('docs');
  const out = [];
  for (const r of rows) {
    try { out.push({ id: r.id, ...(await C.unsealJson(dek, r, metaAad(r.id))) }); }
    catch (e) { console.warn('Registro ilegível ignorado', r.id, e); }
  }
  return out;
}

/**
 * Salva um documento.
 * @param doc    metadados completos (com id)
 * @param added  [{ meta:{id,name,mime,size,label}, bytes:Uint8Array }]
 * @param removedIds ids de anexos removidos
 */
export async function saveDocument(doc, added = [], removedIds = []) {
  const { id, ...meta } = doc;
  const box = await C.sealJson(dek, meta, metaAad(id));
  const blobs = [];
  for (const a of added) {
    const b = await C.seal(dek, a.bytes, blobAad(id, a.meta.id));
    blobs.push({ id: a.meta.id, docId: id, iv: b.iv, ct: b.ct });
  }
  await S.writeDocument({ id, iv: box.iv, ct: box.ct }, blobs, removedIds);
}

export async function readFile(docId, fileId) {
  const rec = await S.get('blobs', fileId);
  if (!rec) throw new Error('Arquivo não encontrado.');
  return C.unseal(dek, rec, blobAad(docId, fileId));
}

export const purgeDocument = id => S.deleteDocument(id);

export async function wipe() {
  await S.clearAll();
  dek = null;
}
