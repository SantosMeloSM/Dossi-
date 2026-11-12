// Primitivas criptográficas (Web Crypto). Nada sai do dispositivo.
const te = new TextEncoder();
const td = new TextDecoder();

export const PBKDF2_ITERATIONS = 310000;
export const rand = n => crypto.getRandomValues(new Uint8Array(n));
export const utf8 = s => te.encode(s);
export const fromUtf8 = b => td.decode(b);

export async function deriveKek(secret, salt, iterations = PBKDF2_ITERATIONS) {
  const material = await crypto.subtle.importKey('raw', utf8(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new Uint8Array(salt), iterations, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Importa uma chave AES-GCM bruta como não extraível. */
export const importAesKey = raw => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

export async function seal(key, data, aad) {
  const iv = rand(12);
  const params = { name: 'AES-GCM', iv };
  if (aad) params.additionalData = utf8(aad);
  const ct = new Uint8Array(await crypto.subtle.encrypt(params, key, data));
  return { iv, ct };
}

export async function unseal(key, box, aad) {
  const params = { name: 'AES-GCM', iv: new Uint8Array(box.iv) };
  if (aad) params.additionalData = utf8(aad);
  return new Uint8Array(await crypto.subtle.decrypt(params, key, box.ct));
}

export const sealJson = (key, obj, aad) => seal(key, utf8(JSON.stringify(obj)), aad);
export const unsealJson = async (key, box, aad) => JSON.parse(fromUtf8(await unseal(key, box, aad)));

export async function sha256Hex(bytes) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...h].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------- Base64 ----------
export function toB64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(out);
}
export function fromB64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- Chave de recuperação (Base32 Crockford, 25 caracteres = 125 bits) ----------
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function newRecoveryCode() {
  const bytes = rand(25);
  const chars = [...bytes].map(b => B32[b & 31]).join('');
  return chars.match(/.{5}/g).join('-');
}
export function normalizeRecoveryCode(code) {
  return String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
}
