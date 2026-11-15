// Leitura automática: transforma o texto reconhecido (OCR) em campos do documento.
// Entrada: linhas [{ t, x, y, w, h, p }] (texto, caixa na imagem e página). Tudo roda no aparelho.
import { isValidCPF, formatCPF, isValidPlate, formatPlate } from './data.js';

// ------------------------------------------------------------------ utilidades
export const N = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const DIGIT_FIX = { O: '0', o: '0', Q: '0', D: '0', U: '0', I: '1', l: '1', '|': '1', '!': '1', i: '1', L: '1', S: '5', s: '5', B: '8', Z: '2', z: '2', G: '6', T: '7' };
/** Corrige letras confundidas com dígitos em "palavras" predominantemente numéricas. */
export function numView(t) {
  return String(t || '').split(/(\s+)/).map(tok => {
    const digits = (tok.match(/\d/g) || []).length;
    const letters = (tok.match(/[A-Za-z|!]/g) || []).length;
    if (digits >= 2 && digits >= letters * 1.5) return tok.replace(/[OoQDUIl|!iLSsBZzGT]/g, c => DIGIT_FIX[c] || c);
    return tok;
  }).join('');
}
const PARTICLES = new Set(['DA', 'DE', 'DO', 'DAS', 'DOS', 'E', 'DI', 'DU', 'VAN', 'VON', 'DEL', 'LA']);
export function titleCase(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim().split(' ')
    .map((w, i) => (i > 0 && PARTICLES.has(w.toUpperCase())) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
const UF = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const STATE_NAMES = { ACRE: 'AC', ALAGOAS: 'AL', AMAPA: 'AP', AMAZONAS: 'AM', BAHIA: 'BA', CEARA: 'CE', 'DISTRITO FEDERAL': 'DF', 'ESPIRITO SANTO': 'ES', GOIAS: 'GO', MARANHAO: 'MA', 'MATO GROSSO DO SUL': 'MS', 'MATO GROSSO': 'MT', 'MINAS GERAIS': 'MG', PARA: 'PA', PARAIBA: 'PB', PARANA: 'PR', PERNAMBUCO: 'PE', PIAUI: 'PI', 'RIO DE JANEIRO': 'RJ', 'RIO GRANDE DO NORTE': 'RN', 'RIO GRANDE DO SUL': 'RS', RONDONIA: 'RO', RORAIMA: 'RR', 'SANTA CATARINA': 'SC', 'SAO PAULO': 'SP', SERGIPE: 'SE', TOCANTINS: 'TO' };
const MONTHS = { JAN: 1, FEV: 2, FEB: 2, MAR: 3, ABR: 4, APR: 4, MAI: 5, MAY: 5, JUN: 6, JUL: 7, AGO: 8, AUG: 8, SET: 9, SEP: 9, OUT: 10, OCT: 10, NOV: 11, DEZ: 12, DEC: 12 };
const pad = n => String(n).padStart(2, '0');

function toISO(d, m, y) {
  d = +d; m = +m; y = +y;
  if (y < 100) y += y > (new Date().getFullYear() % 100) + 20 ? 1900 : 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}
/** Todas as datas de um texto, na ordem em que aparecem. */
export function findDates(text) {
  const s = N(numView(text));
  const out = [];
  const re1 = /(?<!\d)(\d{1,2})\s?[\/\-.]\s?(\d{1,2})\s?[\/\-.]\s?(\d\s?\d{3}|\d{2})(?!\d)/g;
  const re2 = /(?<!\d)(\d{1,2})\s*(?:DE\s+)?(JAN|FEV|FEB|MAR|ABR|APR|MAI|MAY|JUN|JUL|AGO|AUG|SET|SEP|OUT|OCT|NOV|DEZ|DEC)[A-Z]*\.?\s*(?:\/\s*[A-Z]{3,}\.?\s*)?(?:\/|DE)?\s*(\d{4})(?!\d)/g;
  for (const m of s.matchAll(re1)) { const iso = toISO(m[1], m[2], m[3].replace(/\s/g, '')); if (iso) out.push({ iso, at: m.index }); }
  for (const m of s.matchAll(re2)) { const iso = toISO(m[1], MONTHS[m[2]], m[3]); if (iso) out.push({ iso, at: m.index }); }
  return out.sort((a, b) => a.at - b.at).map(x => x.iso);
}
const firstDate = t => findDates(t)[0] || null;

function findCPFs(text) {
  const s = numView(text);
  const out = [];
  for (const m of s.matchAll(/(?<!\d)(\d{3})\s?[.,]?\s?(\d{3})\s?[.,]?\s?(\d{3})\s?[-–.,/]?\s?(\d{2})(?!\d)/g)) {
    const v = m[1] + m[2] + m[3] + m[4];
    if (isValidCPF(v)) out.push(formatCPF(v));
  }
  return out;
}

// ------------------------------------------------------------------ contexto geométrico
export function makeCtx(raw) {
  const lines = raw.filter(l => l && String(l.t || '').trim()).map((l, i) => ({
    t: String(l.t).trim(), x: +l.x || 0, y: +l.y || 0, w: +l.w || 0, h: +l.h || 0, p: +l.p || 0, i, ri: i
  }));
  // Ordem de leitura: página, depois linhas visuais (y), depois x.
  const geo = lines.some(l => l.h > 0);
  if (geo) lines.sort((a, b) => a.p - b.p || (Math.abs(a.y - b.y) < Math.min(a.h, b.h) * 0.5 ? a.x - b.x : a.y - b.y));
  lines.forEach((l, i) => { l.i = i; l.n = N(l.t); l.v = numView(l.t); l.nv = N(l.v); });
  const text = lines.map(l => l.t).join('\n');
  return { lines, geo, text, nt: N(text), nv: N(numView(text)) };
}

/** Linhas candidatas a conter o valor de um rótulo: o restante da própria linha, à direita, abaixo. */
function candidates(ctx, L, maxDown = 3) {
  const out = [];
  if (!ctx.geo) {
    for (let k = 1; k <= maxDown && L.i + k < ctx.lines.length; k++) out.push({ line: ctx.lines[L.i + k], score: k });
    return out;
  }
  const h = L.h || 20;
  for (const l of ctx.lines) {
    if (l === L || l.p !== L.p) continue;
    const dy = l.y - L.y;
    const sameRow = Math.abs(dy) < h * 0.6;
    if (sameRow && l.x > L.x + L.w * 0.5 && l.x - (L.x + L.w) < h * 12) { out.push({ line: l, score: (l.x - L.x - L.w) / h * 0.15 + 0.2 }); continue; }
    if (dy > h * 0.35 && dy < h * (maxDown + 1.3)) {
      const overlap = Math.min(l.x + l.w, L.x + L.w + h * 3) - Math.max(l.x, L.x - h * 1.5);
      if (overlap > 0) out.push({ line: l, score: dy / h + Math.abs(l.x - L.x) / h * 0.12 });
    }
  }
  return out.sort((a, b) => a.score - b.score);
}

/**
 * Procura um valor associado a um rótulo.
 * @param labelRe regex sobre o texto normalizado (maiúsculo, sem acento)
 * @param pick    (textoOriginal, linha) => valor | null
 */
function near(ctx, labelRe, pick, opts = {}) {
  for (const L of ctx.lines) {
    const m = L.n.match(labelRe);
    if (!m) continue;
    // Restante da linha após o rótulo
    const rest = L.t.slice(Math.min(L.t.length, m.index + m[0].length)).replace(/^[\s:.\-–]+/, '');
    if (rest && opts.same !== false && !isLabelOnly(rest)) { const v = pick(rest, L); if (v) return v; }
    const seen = new Set();
    for (const { line } of candidates(ctx, L, opts.down ?? 3)) {
      seen.add(line);
      if (opts.skipLabels !== false && isLabelOnly(line.n)) continue;
      const v = pick(line.t, line);
      if (v) return v;
    }
    // Reserva: as linhas seguintes na ordem em que o OCR as entregou
    if (ctx.geo) for (const line of ctx.lines.filter(l => l.ri > L.ri && l.ri <= L.ri + 3 && !seen.has(l)).sort((a, b) => a.ri - b.ri)) {
      if (isLabelOnly(line.n)) continue;
      const v = pick(line.t, line);
      if (v) return v;
    }
  }
  return null;
}
const LABEL_SET = new Set(('NOME NOMES CPF CNPJ DATA DE DO DA DOS DAS E EM VALIDADE FILIACAO NATURALIDADE REGISTRO GERAL EMISSAO EXPEDICAO ASSINATURA LOCAL UF ORGAO ORG ' +
  'EMISSOR CATEGORIA CAT HAB OBSERVACOES PERMISSAO ACC DOC IDENTIDADE NASCIMENTO SEXO NACIONALIDADE TIPO ZONA SECAO MUNICIPIO PLACA CHASSI RENAVAM ' +
  'MARCA MODELO VERSAO ANO FABRICACAO COR PREDOMINANTE ESPECIE COMBUSTIVEL ENDERECO CEP VENCIMENTO TOTAL A PAGAR CLIENTE TITULAR CONSUMIDOR ' +
  'SEGURADO ELEITOR EMPREGADOR EMPRESA CARGO FUNCAO ADMISSAO PIS PASEP N NO NUMERO NO. SOBRENOME SURNAME GIVEN NAMES TYPE ISSUING COUNTRY PAIS ' +
  'EMISSOR PASSAPORTE PASSPORT DATE OF BIRTH ISSUE EXPIRY NATIONALITY INSCRICAO CODIGO CRV EXERCICIO REFERENCIA INSTALACAO CONSUMO KWH ' +
  'IMPOSTO RESTITUIR ITEM VIGENCIA APOLICE PROPRIETARIO MATRICULA LIVRO FOLHA TERMO CNS ORIGEM').split(' '));
const isLabelOnly = n => {
  const words = N(n).split(/[\s\/.,:;()\-–ºª°]+/).filter(Boolean);
  return words.length > 0 && words.every(w => LABEL_SET.has(w) || /^\d?[AªºO]?$/.test(w) && w.length <= 2 && !/\d/.test(w));
};

const pickDate = t => firstDate(t);
const pickCPF = t => findCPFs(t)[0] || null;
const BAD_NAME = /\b(REPUBLICA|FEDERATIVA|BRASIL|MINISTERIO|SECRETARIA|DEPARTAMENTO|CARTEIRA|NACIONAL|HABILITACAO|IDENTIDADE|REGISTRO|CERTIDAO|VALIDA|TERRITORIO|ASSINATURA|DOCUMENTO|ESTADO|GOVERNO|PASSAPORTE|PASSPORT|TITULO|ELEITOR|JUSTICA|NASCIMENTO|FILIACAO|DATA|NOME|CPF|CADASTRO|RECEITA|EMISSAO|DETRAN|SENATRAN|DENATRAN|INSTITUTO|POLICIA|LOCAL|VALIDADE|CATEGORIA|OBSERVACOES|SAUDE|CARTAO|UNIVERSIDADE|FACULDADE|DIPLOMA|SEGURO|APOLICE|FATURA|CONTA)\b/;
export function pickName(t) {
  const s = N(t).replace(/[^A-Z\s'.-]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = s.split(' ').filter(w => w.length > 0);
  if (words.length < 2 || s.length < 5 || s.length > 70) return null;
  if (BAD_NAME.test(s)) return null;
  if ((N(t).match(/\d/g) || []).length > 1) return null;
  if (words.filter(w => w.length >= 2).length < 2) return null;
  return titleCase(s);
}
const pickText = (min = 2, max = 80) => t => {
  const s = t.replace(/\s+/g, ' ').trim();
  return s.length >= min && s.length <= max && /[A-Za-zÀ-ú]{2,}/.test(s) && !isLabelOnly(N(s)) ? s : null;
};
const pickRe = (re, fmt = m => m[0]) => t => { const m = N(numView(t)).match(re); return m ? fmt(m) : null; };
const firstLine = (ctx, re) => ctx.lines.find(l => re.test(l.n));

// ------------------------------------------------------------------ detecção da categoria
const SIGNALS = {
  cnh: [[/HABILITACAO/, 5], [/CAT\.?\s*HAB/, 4], [/RENACH/, 4], [/PERMISSAO/, 2], [/\bACC\b/, 1], [/SENATRAN|DENATRAN|DETRAN/, 2], [/(\b1\s*[AªºO°2]?|PRIMEIRA)\s*HABILITA/, 3]],
  identidade: [[/REGISTRO GERAL/, 6], [/CARTEIRA DE IDENTIDADE/, 6], [/IDENTIDADE/, 1], [/FILIACAO/, 2], [/NATURALIDADE/, 3], [/INSTITUTO DE IDENTIFICACAO|IIRGD|SSP\b/, 2], [/EXPEDICAO/, 2]],
  cpf: [[/CADASTRO DE PESSOAS? FISICAS?/, 6], [/COMPROVANTE DE INSCRICAO/, 4], [/SITUACAO CADASTRAL/, 5], [/RECEITA FEDERAL/, 2], [/CPF/, 1]],
  certidoes: [[/CERTIDAO/, 5], [/REGISTRO CIVIL/, 4], [/CARTORIO|OFICIO|OFICIAL/, 2], [/MATRICULA/, 2], [/\bLIVRO\b/, 2], [/\bFOLHA\b|\bFLS?\b/, 1], [/\bTERMO\b/, 2]],
  passaporte: [[/PASSAPORTE|PASSPORT/, 6], [/P[<KC«][A-Z]{3}/, 4], [/DATE OF EXPIRY|DATA DE VALIDADE/, 1]],
  eleitor: [[/TITULO ELEITORAL|TITULO DE ELEITOR/, 7], [/JUSTICA ELEITORAL|ELEITORAL/, 4], [/\bZONA\b/, 2], [/SECAO/, 2], [/INSCRICAO/, 1]],
  veiculos: [[/RENAVAM/, 6], [/CHASSI/, 4], [/LICENCIAMENTO|CRLV|CRV\b/, 5], [/PLACA/, 2], [/VEICULO/, 2], [/MARCA\s*\/?\s*MODELO/, 2], [/EXERCICIO/, 1]],
  trabalho: [[/CARTEIRA DE TRABALHO|CTPS/, 6], [/CONTRATO (INDIVIDUAL )?DE TRABALHO/, 6], [/ADMISSAO/, 3], [/EMPREGADOR/, 3], [/PIS|PASEP|\bNIS\b/, 2], [/CARGO|FUNCAO/, 1], [/HOLERITE|CONTRACHEQUE|SALARIO/, 2]],
  educacao: [[/DIPLOMA/, 6], [/CERTIFICADO DE CONCLUSAO|HISTORICO ESCOLAR/, 6], [/UNIVERSIDADE|FACULDADE|CENTRO UNIVERSITARIO/, 3], [/BACHAREL|LICENCIAD|TECNOLOGO|GRAU DE/, 3], [/COLACAO|CONCLUIU|CURSO/, 2]],
  saude: [[/CARTAO NACIONAL DE SAUDE|CARTAO DO SUS|\bSUS\b/, 6], [/\bCNS\b/, 4], [/PLANO DE SAUDE|OPERADORA|BENEFICIARIO|CARTEIRINHA/, 4], [/VACINA|PACIENTE|EXAME|RECEITUARIO|CRM/, 3], [/SAUDE/, 2]],
  comprovantes: [[/CONTA DE (LUZ|AGUA|ENERGIA|GAS)|ENERGIA ELETRICA|SANEAMENTO/, 6], [/FATURA|SEGUNDA VIA|2A VIA/, 2], [/CONSUMO|KWH|LEITURA/, 3], [/UNIDADE CONSUMIDORA|INSTALACAO|CODIGO DO CLIENTE/, 3], [/COMPROVANTE DE (RESIDENCIA|ENDERECO|RENDA)/, 6], [/\bCEP\b/, 1]],
  financas: [[/IMPOSTO\s*SOBRE\s*A?\s*RENDA|IMPOSTO DE RENDA|IRPF|DIRPF|AJUSTE ANUAL/, 6], [/ANO.?CALENDARIO|EXERCICIO \d{4}/, 3], [/INFORME DE RENDIMENTOS|EXTRATO/, 5], [/BANCO|AGENCIA|CONTA CORRENTE/, 2], [/DECLARACAO/, 1]],
  seguros: [[/APOLICE/, 6], [/SEGURADORA/, 5], [/SEGURADO|SINISTRO|VIGENCIA/, 3], [/NOTA FISCAL|NF-?E|DANFE/, 4], [/GARANTIA/, 3]]
};
export function detectCategory(ctx) {
  let best = null, bestScore = 0;
  for (const [cat, sigs] of Object.entries(SIGNALS)) {
    let sc = 0;
    for (const [re, w] of sigs) if (re.test(ctx.nt)) sc += w;
    if (sc > bestScore) { bestScore = sc; best = cat; }
  }
  return bestScore >= 5 ? best : null;
}

// ------------------------------------------------------------------ extratores por categoria
function stateCode(n) {
  for (const [name, uf] of Object.entries(STATE_NAMES)) if (new RegExp('\\b' + name + '\\b').test(n)) return uf;
  return null;
}
const ORGS = /\b(SSP|SDS|SESP|SESDEC|SEJUSP|SSPDS|SSPDC|IIRGD|DETRAN|IFP|IGP|SJS|SEDS|DGPC|ITEP|PC|PCMG|SPTC|IICCDF|DIC|POLICIA CIVIL|MRE|DPF|SJTC|SESEG|SSPAL)\b\s*[\/\-]?\s*([A-Z]{2})?\b/;
function orgUF(ctx) {
  const lines = ctx.lines.filter(l => ORGS.test(l.n) && !/SECRETARIA DE SEGURANCA|DEPARTAMENTO/.test(l.n));
  for (const l of lines) {
    const m = l.n.match(ORGS);
    const uf = m[2] && UF.includes(m[2]) ? m[2] : null;
    return { orgao: m[1] + (uf ? '/' + uf : ''), uf };
  }
  return { orgao: null, uf: null };
}
function dateRange(ctx) {
  const ds = findDates(ctx.text);
  return ds;
}

const X = {
  cnh(ctx) {
    const r = { details: {} };
    r.details.nome = near(ctx, /\bNOME\b/, pickName);
    r.details.cpf = near(ctx, /\bCPF\b/, pickCPF) || findCPFs(ctx.text)[0] || null;
    r.number = near(ctx, /(N[°ºO.]?\s*(DE\s*|DO\s*)?REGISTRO|\bREGISTRO\b)/, pickRe(/(?<!\d)\d{9,11}(?!\d)/, m => m[0].padStart(11, '0')));
    r.expiresAt = near(ctx, /VALIDADE/, pickDate);
    r.details.primeira = near(ctx, /(\b1\s*[AªºO°2]?|PRIMEIRA)\s*HABILITA/, pickDate);
    r.details.nascimento = near(ctx, /NASCIMENTO/, pickDate);
    r.issuedAt = near(ctx, /EMISSAO/, pickDate);
    r.details.classe = near(ctx, /CAT\.?\s*HAB|CATEGORIA/, t => { const m = N(t).match(/(?<![A-Z])(ACC|AB|AC|AD|AE|A|B|C|D|E)(?![A-Z])/); return m ? m[1] : null; });
    const ren = ctx.nt.match(/\b([A-Z]{2})\s?([0-9OIS]{9})\b/);
    r.details.renach = ren && UF.includes(ren[1]) && /\d{6}/.test(ren[2]) ? ren[1] + ren[2].replace(/[OIS]/g, c => DIGIT_FIX[c]) : null;
    const det = ctx.nt.match(/DETRAN\s*[-\/]?\s*([A-Z]{2})\b/);
    r.details.orgao = det && UF.includes(det[1]) ? 'DETRAN/' + det[1] : null;
    // Datas sem rótulo reconhecido: a mais distante no futuro é a validade.
    const ds = dateRange(ctx);
    if (!r.expiresAt) { const fut = ds.filter(d => d > r.issuedAt || '').sort().pop(); if (fut && fut > new Date().toISOString().slice(0, 10).replace(/^\d{4}/, y => y - 1)) r.expiresAt = fut; }
    if (!r.details.nascimento && ds.length) { const old = [...ds].sort()[0]; if (old < '2010') r.details.nascimento = old; }
    if (r.details.cpf && r.number && r.number === r.details.cpf.replace(/\D/g, '')) r.number = null;
    return r;
  },

  identidade(ctx) {
    const r = { details: {} };
    r.details.nome = near(ctx, /\bNOME\b/, pickName);
    r.details.cpf = near(ctx, /\bCPF\b/, pickCPF) || findCPFs(ctx.text)[0] || null;
    r.number = near(ctx, /REGISTRO GERAL|\bR\.?G\.?\b|N[°º.]?\s*(DO\s*)?REGISTRO|IDENTIDADE N/, t => {
      const m = N(numView(t)).match(/(?<![\d.])(\d{1,2}\.?\d{3}\.?\d{3}\s?-?\s?[\dX])(?![\d])/) || N(numView(t)).match(/(?<!\d)(\d{5,12}-?[\dX]?)(?!\d)/);
      return m ? m[1].replace(/\s/g, '') : null;
    });
    if (!r.number && /CARTEIRA DE IDENTIDADE/.test(ctx.nt) && r.details.cpf) r.number = r.details.cpf;
    r.details.nascimento = near(ctx, /NASCIMENTO/, pickDate);
    r.issuedAt = near(ctx, /EXPEDICAO|EMISSAO/, pickDate);
    r.expiresAt = near(ctx, /VALIDADE/, pickDate);
    r.details.naturalidade = near(ctx, /NATURALIDADE/, t => { const s = t.replace(/\d.*$/, '').trim(); return /[A-Za-z]{3}/.test(s) && !BAD_NAME.test(N(s)) ? titleCase(s).replace(/\b(\w{2})$/i, x => x.toUpperCase()) : null; });
    // Filiação: até dois nomes abaixo do rótulo
    const L = firstLine(ctx, /FILIACAO/);
    if (L) {
      const names = [];
      const rest = pickName(L.t.replace(/.*FILIA[CÇ][AÃ]O\s*:?/i, ''));
      if (rest) names.push(rest);
      for (const { line } of candidates(ctx, L, 3)) { const n = pickName(line.t); if (n && !names.includes(n) && n !== r.details.nome) names.push(n); if (names.length >= 2) break; }
      if (names.length) r.details.filiacao = names.join(' e ');
    }
    const o = orgUF(ctx);
    r.details.orgao = o.orgao;
    r.details.uf = o.uf || near(ctx, /\bUF\b/, t => { const m = N(t).match(/\b([A-Z]{2})\b/); return m && UF.includes(m[1]) ? m[1] : null; }) || stateCode(ctx.nt);
    return r;
  },

  cpf(ctx) {
    const r = { details: {} };
    r.number = near(ctx, /\bCPF\b|INSCRICAO|NUMERO/, pickCPF) || findCPFs(ctx.text)[0] || null;
    r.details.nome = near(ctx, /\bNOME\b/, pickName);
    r.details.nascimento = near(ctx, /NASCIMENTO/, pickDate);
    const sit = ctx.nt.match(/SITUACAO CADASTRAL\s*:?\s*(REGULAR|PENDENTE DE REGULARIZACAO|SUSPENSA|CANCELADA|NULA)/) || (/SITUACAO/.test(ctx.nt) && ctx.nt.match(/\b(REGULAR|PENDENTE DE REGULARIZACAO|SUSPENSA|CANCELADA|NULA)\b/));
    if (sit) r.details.situacao = { REGULAR: 'Regular', 'PENDENTE DE REGULARIZACAO': 'Pendente de regularização', SUSPENSA: 'Suspensa', CANCELADA: 'Cancelada', NULA: 'Nula' }[sit[1]];
    r.issuedAt = near(ctx, /EMITID|EMISSAO|COMPROVANTE EMITIDO/, pickDate);
    return r;
  },

  certidoes(ctx) {
    const r = { details: {} };
    const t = ctx.nt.match(/CERTIDAO\s+(?:DE\s+|NEGATIVA\s+)?(NASCIMENTO|CASAMENTO|OBITO|DEBITOS|ANTECEDENTES)/) || ctx.nt.match(/CERTIDAO\s+(NEGATIVA)/);
    if (t) r.details.tipo = { NASCIMENTO: 'Nascimento', CASAMENTO: 'Casamento', OBITO: 'Óbito', DEBITOS: 'Negativa de débitos', NEGATIVA: 'Negativa de débitos', ANTECEDENTES: 'Antecedentes' }[t[1]];
    const digits = ctx.nv.replace(/[^\d\n]/g, '');
    const mat = digits.match(/\d{32}/) || ctx.nv.replace(/\s/g, '').match(/\d{28,34}/);
    if (mat) { const d = mat[0].slice(0, 32); r.number = d.length === 32 ? `${d.slice(0, 6)} ${d.slice(6, 8)} ${d.slice(8, 10)} ${d.slice(10, 14)} ${d.slice(14, 15)} ${d.slice(15, 20)} ${d.slice(20, 23)} ${d.slice(23, 30)} ${d.slice(30)}` : d; }
    r.details.nome = near(ctx, /\bNOME\b|REGISTRAD[OA]|FALECID[OA]/, pickName);
    const cart = ctx.lines.find(l => /CARTORIO|OFICIO|REGISTRO CIVIL DAS PESSOAS|OFICIAL DE REGISTRO/.test(l.n) && !/^CERTIDAO/.test(l.n) && l.t.length > 10);
    if (cart) r.details.cartorio = cart.t.replace(/\s+/g, ' ').trim().slice(0, 120);
    const num = re => pickRe(re, m => m[1]);
    r.details.livro = near(ctx, /\bLIVRO\b/, num(/(?:LIVRO\s*(?:N[°º.]?)?\s*:?\s*)?\b([A-Z]?-?\s?\d{1,6}[A-Z]?)\b/));
    r.details.folha = near(ctx, /\bFOLHAS?\b|\bFLS?\.?\b/, num(/(?:FOLHAS?|FLS?\.?)?\s*(?:N[°º.]?)?\s*:?\s*\b(\d{1,5}[A-Z]?)\b/));
    r.details.termo = near(ctx, /\bTERMO\b/, num(/(?:TERMO\s*(?:N[°º.]?)?\s*:?\s*)?\b(\d{1,8})\b/));
    r.issuedAt = near(ctx, /EMISSAO|EXPEDICAO|EMITIDA EM|DATA DO REGISTRO/, pickDate) || findDates(ctx.text).pop() || null;
    r.expiresAt = /NEGATIVA|ANTECEDENTES/.test(ctx.nt) ? near(ctx, /VALIDADE|VALIDA ATE/, pickDate) : null;
    return r;
  },

  passaporte(ctx) {
    const r = { details: {} };
    const mrz = parseMRZ(ctx);
    if (mrz) {
      r.number = mrz.number; r.expiresAt = mrz.expiry;
      r.details.nascimento = mrz.birth; r.details.nome = mrz.name;
      r.details.pais = COUNTRY[mrz.country] || mrz.country;
      r.details.nacionalidade = NATIONALITY[mrz.nationality] || mrz.nationality;
      r.details.tipo = mrz.type === 'P' ? 'Comum' : mrz.type === 'D' ? 'Diplomático' : mrz.type === 'S' ? 'Oficial' : 'Comum';
    }
    r.number ||= near(ctx, /PASSAPORTE N|PASSPORT N|N[°º.]?\s*DO PASSAPORTE|PASSPORT NO/, pickRe(/\b([A-Z]{2}\d{6,7})\b/, m => m[1])) || (ctx.nv.match(/\b([A-Z]{2}\d{6})\b/) || [])[1] || null;
    r.expiresAt ||= near(ctx, /VALIDADE|DATE OF EXPIRY|EXPIRY/, pickDate);
    r.issuedAt = near(ctx, /EXPEDICAO|DATE OF ISSUE|EMISSAO/, pickDate);
    r.details.nascimento ||= near(ctx, /NASCIMENTO|DATE OF BIRTH/, pickDate);
    if (!r.details.nome) {
      const sur = near(ctx, /SOBRENOME|SURNAME/, t => pickName(t + ' X')?.replace(/ X$/, '') || null);
      const giv = near(ctx, /\bNOME\b|GIVEN NAME/, t => pickName(t + ' X')?.replace(/ X$/, '') || null);
      if (sur || giv) r.details.nome = [giv, sur].filter(Boolean).join(' ');
    }
    if (!r.details.pais && /BRASIL|BRAZIL|BRA\b/.test(ctx.nt)) r.details.pais = 'Brasil';
    if (!r.details.nacionalidade && /BRASILEIR/.test(ctx.nt)) r.details.nacionalidade = 'Brasileira';
    r.details.tipo ||= /\bTIPO\b.*\bP\b|TYPE.*\bP\b/.test(ctx.nt) ? 'Comum' : null;
    return r;
  },

  eleitor(ctx) {
    const r = { details: {} };
    r.number = near(ctx, /INSCRICAO|TITULO|NUMERO/, pickRe(/(?<!\d)(\d{4})\s?(\d{4})\s?(\d{4})(?!\d)/, m => `${m[1]} ${m[2]} ${m[3]}`))
      || (ctx.nv.match(/(?<!\d)(\d{4})\s?(\d{4})\s?(\d{4})(?!\d)/) || []).slice(1).join(' ') || null;
    r.details.nome = near(ctx, /\bNOME\b|\bELEITOR\b(?!AL)/, pickName);
    r.details.nascimento = near(ctx, /NASCIMENTO/, pickDate);
    r.issuedAt = near(ctx, /EMISSAO|EXPEDICAO/, pickDate);
    const both = ctx.lines.find(l => /ZONA/.test(l.n) && /SECAO/.test(l.n));
    if (both) {
      const own = both.nv.match(/ZONA\D*(\d{1,4})\D+SECAO\D*(\d{1,4})/);
      if (own) { r.details.zona = own[1]; r.details.secao = own[2]; }
      else for (const { line } of candidates(ctx, both, 2)) {
        const nums = line.nv.match(/\b\d{1,4}\b/g);
        if (nums && nums.length >= 2) { r.details.zona = nums[0]; r.details.secao = nums[1]; break; }
      }
    }
    r.details.zona ||= near(ctx, /\bZONA\b/, pickRe(/\b(\d{1,4})\b/, m => m[1]));
    r.details.secao ||= near(ctx, /\bSECAO\b/, pickRe(/\b(\d{1,4})\b/, m => m[1]));
    r.details.municipio = near(ctx, /MUNICIPIO/, t => { const s = t.replace(/\d+/g, '').replace(/\s+/g, ' ').trim(); if (!/[A-Za-z]{3}/.test(s) || isLabelOnly(N(s))) return null; return titleCase(s).replace(/([\/\- ])(\w{2})$/i, (a, b, c) => b + c.toUpperCase()); });
    return r;
  },

  veiculos(ctx) {
    const r = { details: {} };
    const plateFrom = t => {
      for (const m of N(t).matchAll(/\b([A-Z]{3})\s?-?\s?([0-9OIS][A-Z0-9][0-9OIS]{2})\b/g)) {
        const tail = m[2].split('').map((c, i) => i === 1 ? c : (DIGIT_FIX[c] || c)).join('');
        const p = m[1] + tail;
        if (isValidPlate(p)) return formatPlate(p);
      }
      return null;
    };
    r.details.placa = near(ctx, /\bPLACA\b/, plateFrom) || plateFrom(ctx.text);
    r.details.renavam = near(ctx, /RENAVAM/, pickRe(/(?<!\d)(\d{9,11})(?!\d)/, m => m[1].padStart(11, '0')));
    const vin = t => { for (const m of N(t).replace(/[\s-]/g, ' ').matchAll(/\b([A-Z0-9]{17})\b/g)) { const v = m[1].replace(/[OQ]/g, '0').replace(/I/g, '1'); if (/\d/.test(v) && /[A-Z]/.test(v) && /\d{4}$/.test(v)) return v; } return null; };
    r.details.chassi = near(ctx, /CHASSI/, vin) || vin(ctx.text);
    r.details.modelo = near(ctx, /MARCA\s*\/?\s*MODELO|\bMARCA\b/, t => { const s = t.replace(/\s+/g, ' ').trim(); return /[A-Za-z]{2}/.test(s) && !isLabelOnly(N(s)) && !/ANO|COR\b/.test(N(s)) ? s.toUpperCase() : null; });
    r.details.ano = near(ctx, /ANO\s*(DE\s*)?(FAB|MOD)|ANO FABRICACAO|FAB\s*\/\s*MOD/, t => { const y = N(numView(t)).match(/\b((?:19|20)\d{2})\s*\/?\s*((?:19|20)\d{2})\b/); return y ? `${y[1]}/${y[2]}` : null; });
    r.details.proprietario = near(ctx, /PROPRIETARIO|\bNOME\b/, pickName);
    r.number = near(ctx, /\bN[°ºO.]?\s*(DO\s*)?(CRV|CRLV)\b|CODIGO DE SEGURANCA|NUMERO DO CRV/, pickRe(/(?<!\d)(\d{9,12})(?!\d)/, m => m[1]));
    r.issuedAt = near(ctx, /DATA( DE)? EMISSAO|EMITIDO EM|^DATA$/, pickDate);
    return r;
  },

  trabalho(ctx) {
    const r = { details: {} };
    r.details.nome = near(ctx, /\bNOME\b|EMPREGADO|TRABALHADOR|FUNCIONARIO/, pickName);
    r.details.cpf = near(ctx, /\bCPF\b/, pickCPF) || findCPFs(ctx.text)[0] || null;
    r.details.pis = near(ctx, /PIS|PASEP|\bNIS\b|\bNIT\b/, pickRe(/(?<!\d)(\d{3})\.?(\d{5})\.?(\d{2})-?(\d)(?!\d)/, m => `${m[1]}.${m[2]}.${m[3]}-${m[4]}`));
    r.details.empresa = near(ctx, /EMPREGADOR|EMPRESA|RAZAO SOCIAL|CONTRATANTE/, pickText(3, 90));
    r.details.cargo = near(ctx, /CARGO|FUNCAO|OCUPACAO/, pickText(3, 60));
    r.details.admissao = near(ctx, /ADMISSAO|DATA DE INICIO|INICIO/, pickDate);
    r.number = near(ctx, /CTPS|CARTEIRA DE TRABALHO|MATRICULA|N[°º.]\s*REGISTRO/, pickRe(/(?<!\d)(\d{5,10})(?!\d)/, m => m[1]));
    r.issuedAt = near(ctx, /EMISSAO|EXPEDICAO/, pickDate);
    return r;
  },

  educacao(ctx) {
    const r = { details: {} };
    const inst = ctx.lines.find(l => /\b(UNIVERSIDADE|FACULDADE|INSTITUTO FEDERAL|CENTRO UNIVERSITARIO|ESCOLA|COLEGIO|SENAI|SENAC|ETEC|FATEC)\b/.test(l.n));
    if (inst) r.details.instituicao = titleCase(inst.t.replace(/\s+/g, ' ')).replace(/\b(Ufmg|Usp|Unicamp|Ufrj|Senai|Senac|Etec|Fatec|Puc|Ifsp)\b/g, s => s.toUpperCase());
    const c = ctx.nt.match(/(?:CURSO (?:SUPERIOR )?DE|BACHAREL(?:ADO)? EM|LICENCIAD[OA] EM|LICENCIATURA EM|TECNICO EM|TECNOLOGO EM|GRAU DE [A-Z]+ EM|TITULO DE [A-Z]+ EM)\s+([A-Z][A-Z ]{2,60}?)(?=\s*(?:,|\.|\n|EM \d|POR |NA |NO |TENDO|CONFERID|$))/);
    if (c) r.details.curso = titleCase(c[1]);
    const n = ctx.nt.replace(/\n/g, ' ').match(/(?:CONFERE|CONFERIU|OUTORGA|CERTIFICA(?:MOS)? QUE)\s+(?:A|AO|A\(O\)|O)?\s*([A-Z][A-Z ]{5,70}?)\s+(?:O\s+(?:TITULO|GRAU|DIPLOMA)|CONCLUIU|,)/);
    r.details.nome = (n && pickName(n[1])) || near(ctx, /\bNOME\b|ALUN[OA]|DIPLOMAD[OA]|CONCLUINTE/, pickName);
    r.details.conclusao = near(ctx, /CONCLUSAO|COLACAO|COLOU GRAU|CONCLUIU/, pickDate);
    const ds = findDates(ctx.text);
    r.issuedAt = near(ctx, /EXPEDICAO|EMISSAO|EXPEDIDO/, pickDate) || ds[ds.length - 1] || null;
    if (!r.details.conclusao && ds.length > 1) r.details.conclusao = ds[0];
    r.number = near(ctx, /REGISTRO N|REGISTRADO SOB|N[°º.]\s*(DO\s*)?(REGISTRO|DIPLOMA|CERTIFICADO)/, pickRe(/(?<!\d)(\d{2,10})(?!\d)/, m => m[1]));
    return r;
  },

  saude(ctx) {
    const r = { details: {} };
    const cnsFrom = t => {
      for (const m of numView(t).matchAll(/(?<!\d)([1-9]\d{2})\s?(\d{4})\s?(\d{4})\s?(\d{4})(?!\d)/g)) {
        const d = m.slice(1).join('');
        if (validCNS(d)) return `${d.slice(0, 3)} ${d.slice(3, 7)} ${d.slice(7, 11)} ${d.slice(11)}`;
      }
      return null;
    };
    r.details.cns = near(ctx, /\bCNS\b|CARTAO NACIONAL|SUS/, cnsFrom) || cnsFrom(ctx.text);
    r.details.nome = near(ctx, /\bNOME\b|BENEFICIARIO|PACIENTE|TITULAR/, pickName);
    r.details.nascimento = near(ctx, /NASCIMENTO|NASC\.?/, pickDate);
    const plan = ctx.lines.find(l => /\b(UNIMED|AMIL|BRADESCO SAUDE|SULAMERICA|HAPVIDA|NOTREDAME|PORTO SEGURO SAUDE|CASSI|GEAP|PREVENT SENIOR|GOLDEN CROSS|ALLIANZ SAUDE|INTERMEDICA)\b/.test(l.n));
    r.details.plano = plan ? titleCase(plan.t) : near(ctx, /PLANO|OPERADORA|CONVENIO/, pickText(3, 60));
    r.details.tipo_sangue = (ctx.nt.match(/(?:SANGU[A-Z]*|ABO|RH|TIPO)\D{0,12}\b(AB|A|B|O)\s?(\+|-|POS|NEG|POSITIVO|NEGATIVO)/) || []).slice(1, 3).map((x, i) => i ? (x.startsWith('N') || x === '-' ? '-' : '+') : x).join('') || null;
    r.details.profissional = near(ctx, /MEDIC[OA]|CRM|PROFISSIONAL|UNIDADE|CLINICA|HOSPITAL/, pickText(3, 70));
    r.number = near(ctx, /CARTEIRINHA|MATRICULA|N[°º.]?\s*(DO\s*)?(CARTAO|BENEFICIARIO)|CODIGO/, pickRe(/(?<!\d)(\d[\d .]{6,22}\d)(?!\d)/, m => m[1].replace(/\s+/g, ' ')));
    if (!r.number && r.details.cns) r.number = r.details.cns;
    r.expiresAt = near(ctx, /VALIDADE|VALIDO ATE/, pickDate);
    return r;
  },

  comprovantes(ctx) {
    const r = { details: {} };
    r.details.titular = near(ctx, /TITULAR|CLIENTE|\bNOME\b|CONSUMIDOR/, pickName);
    const end = ctx.lines.find(l => /^(RUA|R\.|AV\.?|AVENIDA|AL\.?|ALAMEDA|TRAVESSA|TV\.?|ESTRADA|EST\.?|ROD\.?|RODOVIA|PRACA|LARGO|QUADRA|SQN|SQS|SHIS)\b/.test(l.n));
    if (end) {
      let s = end.t;
      const next = ctx.lines[end.i + 1];
      if (next && /BAIRRO|JARDIM|VILA|CENTRO|PARQUE|^[A-Z ]+-\s?[A-Z]{2}$/.test(next.n) && !/CEP/.test(next.n)) s += ', ' + next.t;
      r.details.endereco = s.replace(/\s+/g, ' ').trim();
    }
    const cep = ctx.nv.match(/(?<!\d)(\d{5})-?\s?(\d{3})(?!\d)/);
    if (cep && (/CEP/.test(ctx.nt))) r.details.cep = `${cep[1]}-${cep[2]}`;
    r.details.referencia = near(ctx, /REFERENCIA|MES|COMPETENCIA/, t => {
      const s = N(numView(t));
      const a = s.match(/\b(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)[A-Z]*\s*[\/\-]?\s*(\d{4}|\d{2})\b/);
      if (a) return `${pad(MONTHS[a[1]])}/${a[2].length === 2 ? '20' + a[2] : a[2]}`;
      const b = s.match(/\b(0[1-9]|1[0-2])\s?\/\s?(20\d{2})\b/);
      return b ? `${b[1]}/${b[2]}` : null;
    });
    r.details.valor = near(ctx, /TOTAL A PAGAR|VALOR A PAGAR|VALOR TOTAL|TOTAL/, pickMoney) || null;
    r.number = near(ctx, /INSTALACAO|UNIDADE CONSUMIDORA|CODIGO DO CLIENTE|N[°º.]?\s*DO CLIENTE|MATRICULA|CONTA CONTRATO/, pickRe(/(?<!\d)(\d[\d.\-\/]{4,18}\d)(?!\d)/, m => m[1]));
    r.issuedAt = near(ctx, /EMISSAO|DATA DE LEITURA|LEITURA ATUAL|APRESENTACAO/, pickDate);
    return r;
  },

  financas(ctx) {
    const r = { details: {} };
    r.details.nome = near(ctx, /\bNOME\b|CONTRIBUINTE|TITULAR|BENEFICIARIO/, pickName);
    r.details.cpf = near(ctx, /\bCPF\b/, pickCPF) || findCPFs(ctx.text)[0] || null;
    const bank = ctx.lines.find(l => /\b(BANCO|CAIXA ECONOMICA|NUBANK|ITAU|BRADESCO|SANTANDER|INTER|SICOOB|SICREDI|RECEITA FEDERAL|C6)\b/.test(l.n));
    if (bank) r.details.instituicao = titleCase(bank.t);
    const y = ctx.nt.match(/(?:ANO.?CALENDARIO|ANO.?BASE)\s*:?\s*(\d{4})/) || ctx.nt.match(/EXERCICIO\s*:?\s*(\d{4})/);
    if (y) r.details.ano = y[0].startsWith('EXERCICIO') ? String(+y[1] - 1) : y[1];
    r.details.valor = near(ctx, /TOTAL|SALDO|IMPOSTO A PAGAR|IMPOSTO A RESTITUIR|VALOR/, pickMoney);
    r.number = near(ctx, /RECIBO|N[°º.]?\s*(DO\s*)?(CONTRATO|DOCUMENTO|DECLARACAO)|AGENCIA\s*\/?\s*CONTA/, pickRe(/(?<!\d)(\d[\d.\-\/ ]{3,24}\d)(?!\d)/, m => m[1].trim()));
    r.issuedAt = near(ctx, /EMISSAO|DATA/, pickDate);
    return r;
  },

  seguros(ctx) {
    const r = { details: {} };
    const ins = ctx.lines.find(l => /SEGURADORA|SEGUROS\b|\bS\.?\s?A\.?\b|LTDA/.test(l.n) && !/SEGURADO\b/.test(l.n));
    if (ins) r.details.seguradora = ins.t.replace(/\s+/g, ' ').trim();
    r.details.segurado = near(ctx, /\bSEGURADO\b|\bTITULAR\b|\bCLIENTE\b|DESTINATARIO|COMPRADOR/, pickName);
    r.number = near(ctx, /APOLICE|NOTA FISCAL|N[°º.]?\s*(DA\s*)?NF|PROPOSTA|CERTIFICADO/, pickRe(/(?<!\d)(\d[\d.\-\/ ]{3,24}\d)(?!\d)/, m => m[1].trim()));
    r.details.bem = near(ctx, /OBJETO|BEM SEGURAD|ITEM SEGURAD|\bITEM\b|PRODUTO|DESCRICAO/, pickText(3, 80));
    const tel = numView(ctx.text).match(/0800\s?\d{3}\s?\d{4}/) || near(ctx, /ASSISTENCIA|TELEFONE|CONTATO|\bSAC\b|CENTRAL/, t => (numView(t).match(/\(?\d{2}\)?\s?\d{4,5}-?\d{4}/) || [])[0] ? [numView(t).match(/\(?\d{2}\)?\s?\d{4,5}-?\d{4}/)[0]] : null);
    if (tel) r.details.contato = tel[0];
    const vig = near(ctx, /VIGENCIA/, t => { const ds = findDates(t); return ds.length >= 2 ? ds : null; });
    if (vig) { r.issuedAt = vig[0]; r.expiresAt = vig[1]; }
    r.expiresAt ||= near(ctx, /FIM DE VIGENCIA|VIGENCIA ATE|VALIDADE|TERMINO|GARANTIA ATE/, pickDate);
    r.issuedAt ||= near(ctx, /INICIO|EMISSAO|DATA DA COMPRA/, pickDate);
    return r;
  },

  outros(ctx) {
    const r = { details: {} };
    r.issuedAt = near(ctx, /EMISSAO|EXPEDICAO|EMITIDO/, pickDate);
    r.expiresAt = near(ctx, /VALIDADE|VALIDO ATE|VENCIMENTO/, pickDate);
    r.number = near(ctx, /\bNUMERO\b|\bN[°º]/, pickRe(/(?<!\d)(\d[\d.\-\/]{3,20}\d)(?!\d)/, m => m[1]));
    return r;
  }
};

function pickMoney(t) {
  const m = N(numView(t)).match(/R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/) || N(numView(t)).match(/(?<![\d,.])(\d{1,3}(?:\.\d{3})*,\d{2})(?![\d,])/);
  return m ? 'R$ ' + m[1] : null;
}
function validCNS(d) {
  if (!/^[1-9]\d{14}$/.test(d)) return false;
  let s = 0;
  for (let i = 0; i < 15; i++) s += +d[i] * (15 - i);
  return s % 11 === 0;
}

// ------------------------------------------------------------------ MRZ (passaporte)
const COUNTRY = { BRA: 'Brasil', PRT: 'Portugal', USA: 'Estados Unidos', ITA: 'Itália', ESP: 'Espanha', ARG: 'Argentina', DEU: 'Alemanha', D: 'Alemanha', FRA: 'França', GBR: 'Reino Unido', JPN: 'Japão', URY: 'Uruguai', PRY: 'Paraguai', CHL: 'Chile', CAN: 'Canadá' };
const NATIONALITY = { BRA: 'Brasileira', PRT: 'Portuguesa', USA: 'Norte-americana', ITA: 'Italiana', ESP: 'Espanhola', ARG: 'Argentina', DEU: 'Alemã', FRA: 'Francesa', GBR: 'Britânica', JPN: 'Japonesa', URY: 'Uruguaia', PRY: 'Paraguaia', CHL: 'Chilena', CAN: 'Canadense' };
function mrzCheck(s) {
  const w = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const v = c === '<' ? 0 : /\d/.test(c) ? +c : c.charCodeAt(0) - 55;
    sum += v * w[i % 3];
  }
  return sum % 10;
}
const mrzDate = (yymmdd, future) => {
  const yy = +yymmdd.slice(0, 2), mm = yymmdd.slice(2, 4), dd = yymmdd.slice(4, 6);
  const now = new Date().getFullYear() % 100;
  const y = future ? 2000 + yy : (yy > now ? 1900 + yy : 2000 + yy);
  return toISO(dd, mm, y);
};
export function parseMRZ(ctx) {
  const rows = ctx.lines.map(l => l.t.toUpperCase().replace(/[«‹(\[{]/g, '<').replace(/\s+/g, '')).filter(s => (s.match(/</g) || []).length >= 2 || /^[A-Z0-9<]{30,}$/.test(s));
  // Linha 2: número(9) dv nac(3) nasc(6) dv sexo validade(6) dv
  for (const raw of rows) {
    const s = raw.replace(/[^A-Z0-9<]/g, '');
    const m = s.match(/([A-Z0-9<]{9})([0-9OIS])([A-Z<]{3})([0-9OISBZ]{6})([0-9OIS])([MF<X])([0-9OISBZ]{6})([0-9OIS])/);
    if (!m) continue;
    const fix = x => x.replace(/[OISBZ]/g, c => DIGIT_FIX[c]);
    const num = m[1], birth = fix(m[4]), exp = fix(m[7]);
    let ok = 0;
    if (mrzCheck(birth) === +fix(m[5])) ok++;
    if (mrzCheck(exp) === +fix(m[8])) ok++;
    if (mrzCheck(num) === +fix(m[2])) ok++;
    if (ok < 2) continue;
    const res = { number: num.replace(/</g, ''), nationality: m[3].replace(/</g, ''), birth: mrzDate(birth, false), expiry: mrzDate(exp, true), sex: m[6] };
    // Linha 1: P<BRASOBRENOME<<NOMES
    const l1 = rows.find(r => /^[PDSV][A-Z<][A-Z<]{3}[A-Z<]{5,}/.test(r) && r !== raw);
    if (l1) {
      res.type = l1[0]; res.country = l1.slice(2, 5).replace(/</g, '');
      const names = l1.slice(5).replace(/[^A-Z<]/g, '').split(/<<+/).filter(Boolean);
      const surname = (names[0] || '').replace(/</g, ' ');
      const given = (names[1] || '').replace(/</g, ' ');
      res.name = titleCase(`${given} ${surname}`.replace(/\b[KC]\b/g, '').trim());
    } else { res.type = 'P'; res.country = res.nationality; }
    return res;
  }
  return null;
}

// ------------------------------------------------------------------ API
/**
 * Analisa linhas OCR. Se `category` vier, usa-a; senão detecta.
 * Retorna { category, detected, number, issuedAt, expiresAt, details, title }
 */
export function analyze(lines, category = null) {
  const ctx = makeCtx(lines);
  const detected = detectCategory(ctx);
  const cat = category && X[category] ? category : (detected || 'outros');
  const r = X[cat](ctx);
  const details = {};
  for (const [k, v] of Object.entries(r.details || {})) if (v) details[k] = String(v).trim();
  // Sanidade de datas
  const today = new Date().toISOString().slice(0, 10);
  if (details.nascimento && details.nascimento > today) delete details.nascimento;
  if (r.issuedAt && r.issuedAt > today) r.issuedAt = null;
  if (r.issuedAt && r.expiresAt && r.expiresAt < r.issuedAt) r.expiresAt = null;
  return {
    category: cat, detected,
    number: r.number || '', issuedAt: r.issuedAt || '', expiresAt: r.expiresAt || '',
    details, title: suggestTitle(cat, r, details),
    chars: ctx.text.length
  };
}

const CAT_TITLES = { cnh: 'CNH', identidade: 'RG', cpf: 'CPF', certidoes: 'Certidão', passaporte: 'Passaporte', eleitor: 'Título de eleitor', veiculos: 'CRLV', trabalho: 'Carteira de trabalho', educacao: 'Diploma', saude: 'Cartão de saúde', comprovantes: 'Comprovante de residência', financas: 'Documento financeiro', seguros: 'Apólice/garantia', outros: '' };
function suggestTitle(cat, r, d) {
  const first = (d.nome || d.titular || d.segurado || d.proprietario || '').split(' ')[0];
  if (cat === 'veiculos' && d.placa) return `CRLV ${d.placa}`;
  if (cat === 'certidoes' && d.tipo) return `Certidão de ${d.tipo.toLowerCase()}${first ? ' – ' + first : ''}`;
  if (cat === 'comprovantes' && d.referencia) return `Comprovante ${d.referencia}`;
  if (cat === 'identidade' && /CARTEIRA DE IDENTIDADE/.test(N(r.raw || ''))) return `CIN${first ? ' de ' + first : ''}`;
  if (cat === 'saude' && d.cns) return `Cartão SUS${first ? ' de ' + first : ''}`;
  const base = CAT_TITLES[cat];
  if (!base) return '';
  return first ? `${base} de ${first}` : base;
}
