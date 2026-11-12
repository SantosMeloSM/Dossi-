// Backup cifrado: exportação (formato v2) e leitura de backups v2 e do Dossiê 1.x (v1).
import * as C from './crypto.js';
import * as S from './store.js';

export const BACKUP_FORMAT = 'dossie-backup';

const enc64 = o => {
  const out = {};
  for (const [k, v] of Object.entries(o)) out[k] = v instanceof Uint8Array || v instanceof ArrayBuffer ? C.toB64(v) : v;
  return out;
};

/** Gera o backup como Blob, sem reprocessar a criptografia (cópia fiel dos registros). */
export async function buildBackupBlob() {
  const vault = await S.get('meta', 'vault');
  const settings = await S.get('meta', 'settings');
  const docs = await S.getAll('docs');
  const head = {
    format: BACKUP_FORMAT, version: 2, createdAt: new Date().toISOString(),
    vault: { pw: enc64(vault.pw), rec: vault.rec ? enc64(vault.rec) : null },
    settings: enc64({ iv: settings.iv, ct: settings.ct }),
    docs: docs.map(d => enc64({ id: d.id, iv: d.iv, ct: d.ct }))
  };
  const json = JSON.stringify(head);
  const parts = [json.slice(0, -1), ',"blobs":['];
  // Anexos um a um, para não montar uma única string gigante.
  let first = true;
  for (const d of docs) {
    const ids = await S.blobKeysForDoc(d.id);
    for (const id of ids) {
      const b = await S.get('blobs', id);
      parts.push((first ? '' : ',') + JSON.stringify(enc64({ id: b.id, docId: b.docId, iv: b.iv, ct: b.ct })));
      first = false;
    }
  }
  parts.push(']}');
  return new Blob(parts, { type: 'application/json' });
}

export function backupFileName() {
  return `dossie-backup-${new Date().toISOString().slice(0, 10)}.json`;
}

/** Valida a estrutura e identifica a versão. */
export function parseBackup(text) {
  let b;
  try { b = JSON.parse(text); } catch { throw new Error('Arquivo não é um backup válido.'); }
  if (b?.format === BACKUP_FORMAT && b.version === 2) {
    if (!b.vault?.pw || !Array.isArray(b.docs) || !Array.isArray(b.blobs)) throw new Error('Backup incompleto.');
    return { kind: 'v2', data: b, count: b.docs.length };
  }
  if (b?.format === 'dossie-encrypted-v1') {
    if (!b.config || !Array.isArray(b.documents)) throw new Error('Backup v1 incompleto.');
    const it = b.config.iterations;
    if (!Number.isSafeInteger(it) || it < 100000 || it > 2000000) throw new Error('Parâmetros de segurança inválidos.');
    return { kind: 'v1', data: b, count: b.documents.length };
  }
  throw new Error('Formato de backup não reconhecido.');
}

const V1_DETAIL_MAP = {
  cnh: { habilitacao: 'primeira' },
  trabalho: { funcao: 'cargo' },
  saude: { instituicao: 'profissional' }
};

/**
 * Abre um backup com a senha e devolve um leitor:
 *  { settings, documents: async iterator de { meta, files:[{meta, bytes}] } }
 */
export async function openBackup(parsed, password) {
  if (parsed.kind === 'v2') {
    const b = parsed.data;
    const w = b.vault.pw;
    let key;
    try {
      const kek = await C.deriveKek(password, C.fromB64(w.salt), w.iterations);
      const raw = await C.unseal(kek, { iv: C.fromB64(w.iv), ct: C.fromB64(w.ct) }, 'dossie:dek');
      key = await C.importAesKey(raw); raw.fill(0);
    } catch { throw new Error('Senha do backup incorreta.'); }
    let settings = null;
    try { settings = await C.unsealJson(key, { iv: C.fromB64(b.settings.iv), ct: C.fromB64(b.settings.ct) }, 'dossie:settings'); } catch { /* opcional */ }
    const byDoc = new Map();
    for (const bl of b.blobs) { if (!byDoc.has(bl.docId)) byDoc.set(bl.docId, []); byDoc.get(bl.docId).push(bl); }
    async function* documents() {
      for (const d of b.docs) {
        const meta = await C.unsealJson(key, { iv: C.fromB64(d.iv), ct: C.fromB64(d.ct) }, 'dossie:doc:' + d.id);
        const blobs = byDoc.get(d.id) || [];
        const files = [];
        for (const f of meta.files || []) {
          const bl = blobs.find(x => x.id === f.id);
          if (!bl) continue;
          const bytes = await C.unseal(key, { iv: C.fromB64(bl.iv), ct: C.fromB64(bl.ct) }, `dossie:file:${d.id}:${f.id}`);
          files.push({ meta: f, bytes });
        }
        yield { meta: { id: d.id, ...meta }, files };
      }
    }
    return { settings, documents };
  }

  // ---- v1 (Dossiê 1.x) ----
  const b = parsed.data;
  const key = await C.deriveKek(password, C.fromB64(b.config.salt), b.config.iterations);
  try {
    const check = C.fromUtf8(await C.unseal(key, { iv: C.fromB64(b.config.iv), ct: C.fromB64(b.config.cipher) }));
    if (check !== 'dossie-v1-verified') throw 0;
  } catch { throw new Error('Senha do backup incorreta.'); }
  async function* documents() {
    for (const d of b.documents) {
      const m = await C.unsealJson(key, { iv: C.fromB64(d.metaIv), ct: C.fromB64(d.metaCipher) });
      const bytes = await C.unseal(key, { iv: C.fromB64(d.fileIv), ct: C.fromB64(d.fileCipher) });
      const map = V1_DETAIL_MAP[m.category] || {};
      const details = {};
      for (const [k, v] of Object.entries(m.details || {})) details[map[k] || k] = v;
      const fileId = crypto.randomUUID();
      yield {
        meta: {
          id: d.id, title: m.title || 'Documento', category: m.category || 'outros', personId: 'me',
          number: m.number || '', issuedAt: m.issuedAt || '', expiresAt: m.expiresAt || '', notes: m.notes || '',
          details, tags: [], favorite: !!m.favorite, createdAt: m.createdAt, updatedAt: m.updatedAt || m.createdAt,
          deletedAt: null, thumb: typeof m.thumb === 'string' && m.thumb.startsWith('data:image/') ? m.thumb : '',
          files: [{ id: fileId, name: m.fileName || 'arquivo', mime: m.mime || 'application/octet-stream', size: bytes.length, label: '' }]
        },
        files: [{ meta: { id: fileId, name: m.fileName || 'arquivo', mime: m.mime || 'application/octet-stream', size: bytes.length, label: '' }, bytes }]
      };
    }
  }
  return { settings: null, documents };
}
