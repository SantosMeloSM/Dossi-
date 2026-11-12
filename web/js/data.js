// Catálogo de categorias, campos específicos e utilidades de formatação/validação.

/** Campo: [chave, rótulo, tipo?, opções?]  tipo: text | date | cpf | select | plate */
export const BUILTIN_CATEGORIES = [
  { id: 'identidade', name: 'Identidade', hint: 'RG e CIN', icon: 'idcard', color: '#4f8df7',
    numberLabel: 'Número do RG/CIN',
    fields: [['cpf', 'CPF', 'cpf'], ['orgao', 'Órgão emissor'], ['uf', 'UF'], ['nascimento', 'Nascimento', 'date'], ['naturalidade', 'Naturalidade'], ['filiacao', 'Filiação']] },
  { id: 'cnh', name: 'CNH', hint: 'Habilitação', icon: 'car', color: '#8b6cf6',
    numberLabel: 'Nº de registro',
    fields: [['cpf', 'CPF', 'cpf'], ['renach', 'RENACH'], ['classe', 'Categoria', 'select', ['A', 'B', 'AB', 'C', 'D', 'E', 'AC', 'AD', 'AE', 'ACC']], ['primeira', '1ª habilitação', 'date'], ['orgao', 'Órgão emissor']] },
  { id: 'cpf', name: 'CPF', hint: 'Cadastro de pessoa física', icon: 'number', color: '#16a394',
    numberLabel: 'Número do CPF', numberType: 'cpf',
    fields: [['nascimento', 'Nascimento', 'date'], ['situacao', 'Situação cadastral', 'select', ['Regular', 'Pendente de regularização', 'Suspensa', 'Cancelada', 'Nula']]] },
  { id: 'certidoes', name: 'Certidões', hint: 'Nascimento, casamento, óbito', icon: 'scroll', color: '#d9902f',
    numberLabel: 'Matrícula',
    fields: [['tipo', 'Tipo', 'select', ['Nascimento', 'Casamento', 'Óbito', 'Negativa de débitos', 'Antecedentes', 'Outra']], ['cartorio', 'Cartório'], ['livro', 'Livro'], ['folha', 'Folha'], ['termo', 'Termo']] },
  { id: 'passaporte', name: 'Passaporte', hint: 'Passaporte e vistos', icon: 'globe', color: '#2b7bb9',
    numberLabel: 'Número do passaporte',
    fields: [['pais', 'País emissor'], ['tipo', 'Tipo', 'select', ['Comum', 'Diplomático', 'Oficial', 'Visto']], ['nacionalidade', 'Nacionalidade'], ['nascimento', 'Nascimento', 'date']] },
  { id: 'eleitor', name: 'Título de eleitor', hint: 'Zona e seção', icon: 'ballot', color: '#3aa35b',
    numberLabel: 'Número do título',
    fields: [['zona', 'Zona'], ['secao', 'Seção'], ['municipio', 'Município/UF']] },
  { id: 'comprovantes', name: 'Comprovantes', hint: 'Endereço e renda', icon: 'home', color: '#a2793f',
    numberLabel: 'Referência',
    fields: [['endereco', 'Endereço'], ['titular', 'Titular'], ['referencia', 'Mês de referência']] },
  { id: 'veiculos', name: 'Veículos', hint: 'CRLV, seguro e IPVA', icon: 'car', color: '#df5a5a',
    numberLabel: 'Nº do documento',
    fields: [['placa', 'Placa', 'plate'], ['renavam', 'RENAVAM'], ['chassi', 'Chassi'], ['modelo', 'Marca/modelo'], ['ano', 'Ano/modelo']] },
  { id: 'trabalho', name: 'Trabalho', hint: 'Contratos e carteira', icon: 'briefcase', color: '#4766c9',
    numberLabel: 'Nº de registro',
    fields: [['empresa', 'Empresa'], ['cargo', 'Cargo'], ['admissao', 'Admissão', 'date'], ['pis', 'PIS/NIS']] },
  { id: 'educacao', name: 'Educação', hint: 'Diplomas e históricos', icon: 'cap', color: '#b257c7',
    numberLabel: 'Nº do certificado',
    fields: [['instituicao', 'Instituição'], ['curso', 'Curso'], ['conclusao', 'Conclusão', 'date']] },
  { id: 'saude', name: 'Saúde', hint: 'Cartões, exames e receitas', icon: 'heart', color: '#e0567f',
    numberLabel: 'Nº da carteirinha',
    fields: [['cns', 'Cartão SUS'], ['plano', 'Plano de saúde'], ['profissional', 'Profissional/unidade'], ['tipo_sangue', 'Tipo sanguíneo', 'select', ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']]] },
  { id: 'financas', name: 'Finanças', hint: 'Imposto, contratos, bancos', icon: 'coins', color: '#c2a01c',
    numberLabel: 'Referência',
    fields: [['instituicao', 'Instituição'], ['ano', 'Ano-base'], ['valor', 'Valor']] },
  { id: 'seguros', name: 'Seguros e garantias', hint: 'Apólices e notas fiscais', icon: 'umbrella', color: '#3a9fbf',
    numberLabel: 'Nº da apólice/nota',
    fields: [['seguradora', 'Empresa'], ['bem', 'Bem coberto'], ['contato', 'Contato/assistência']] },
  { id: 'outros', name: 'Outros', hint: 'Qualquer arquivo importante', icon: 'folder', color: '#7b8798',
    numberLabel: 'Número ou referência', fields: [] }
];

export const CUSTOM_ICONS = ['folder', 'file', 'idcard', 'home', 'car', 'heart', 'coins', 'cap', 'briefcase', 'globe', 'umbrella', 'star', 'tag', 'scroll', 'key', 'layers'];
export const PALETTE = ['#4f8df7', '#8b6cf6', '#16a394', '#d9902f', '#df5a5a', '#e0567f', '#3aa35b', '#b257c7', '#c2a01c', '#3a9fbf', '#7b8798', '#a2793f'];

export const TAG_SUGGESTIONS = ['original', 'cópia autenticada', 'digital', 'frente e verso', 'urgente', 'renovar'];

// ---------- formatação ----------
const UTC_FMT = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' });
export const fmtDate = s => s ? UTC_FMT.format(new Date(s + 'T12:00:00Z')) : '';
export const fmtLongDate = d => new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
export const fmtBytes = b => !b ? '0 B' : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : b < 1073741824 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1073741824).toFixed(2)} GB`;
export const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
export function daysUntil(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86400000);
}
export function relativeDays(n) {
  if (n === null) return '';
  if (n < -1) return `venceu há ${-n} dias`;
  if (n === -1) return 'venceu ontem';
  if (n === 0) return 'vence hoje';
  if (n === 1) return 'vence amanhã';
  if (n < 60) return `vence em ${n} dias`;
  const months = Math.round(n / 30.4);
  return months < 24 ? `vence em ${months} meses` : `vence em ${Math.round(n / 365)} anos`;
}
export function expiryStatus(iso, warnDays) {
  const n = daysUntil(iso);
  if (n === null) return { key: 'none', n, label: 'Sem validade' };
  if (n < 0) return { key: 'expired', n, label: 'Vencido' };
  if (n <= warnDays) return { key: 'soon', n, label: n === 0 ? 'Vence hoje' : `Vence em ${n}d` };
  return { key: 'ok', n, label: 'Válido' };
}

// ---------- CPF ----------
export const onlyDigits = s => String(s || '').replace(/\D/g, '');
export function formatCPF(v) {
  const d = onlyDigits(v).slice(0, 11);
  return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
}
export function isValidCPF(v) {
  const d = onlyDigits(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = len => { let sum = 0; for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i); const r = (sum * 10) % 11; return r === 10 ? 0 : r; };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}
export function formatPlate(v) {
  const s = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
  return /^[A-Z]{3}\d{4}$/.test(s) ? s.slice(0, 3) + '-' + s.slice(3) : s;
}
export function isValidPlate(v) {
  const s = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(s);
}
export function mask(value) {
  const s = String(value || '');
  if (s.length <= 4) return '•'.repeat(s.length);
  return '•'.repeat(Math.max(3, s.length - 4)).slice(0, 10) + s.slice(-4);
}

export function passwordStrength(pw) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (pw.length >= 16) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (/^(.)\1+$/.test(pw) || /^(123|abc|senha|password|qwerty)/i.test(pw)) score = Math.min(score, 1);
  const level = score <= 2 ? 0 : score <= 3 ? 1 : score <= 4 ? 2 : 3;
  return { level, label: ['Fraca', 'Razoável', 'Boa', 'Excelente'][level] };
}
