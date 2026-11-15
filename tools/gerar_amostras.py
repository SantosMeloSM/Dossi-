"""Gera documentos FICTÍCIOS para testar a leitura automática (OCR) do Dossiê.

Os layouts são próprios e simplificados (só usam os rótulos usuais de cada documento);
todos os nomes e números são inventados, com dígitos verificadores válidos.
Saída: android/app/src/debug/assets/ocr-samples/*.png|jpg + expected.json (só no APK de debug)
e tools/amostras-linhas.json (texto ideal com caixas, para testes do parser no Node).
"""
import json, math, os, random
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'android/app/src/debug/assets/ocr-samples')
os.makedirs(OUT, exist_ok=True)
F = '/usr/share/fonts/truetype/dejavu/'
def font(size, bold=False, mono=False):
    name = 'DejaVuSansMono.ttf' if mono else ('DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf')
    return ImageFont.truetype(F + name, size)

# ---------- números válidos ----------
def cpf(base9):
    d = [int(c) for c in base9]
    for n in (10, 11):
        s = sum(v * (n - i) for i, v in enumerate(d)); r = (s * 10) % 11; d.append(0 if r == 10 else r)
    s = ''.join(map(str, d)); return f'{s[:3]}.{s[3:6]}.{s[6:9]}-{s[9:]}'
def cns(base11):
    s = sum(int(c) * (15 - i) for i, c in enumerate(base11))
    # completa com 000 + dv para pis-like; procura sufixo que valida
    for suf in range(10000):
        cand = base11 + f'{suf:04d}'
        if sum(int(c) * (15 - i) for i, c in enumerate(cand)) % 11 == 0:
            return f'{cand[:3]} {cand[3:7]} {cand[7:11]} {cand[11:]}'
def mrz_cd(s):
    w = [7, 3, 1]; t = 0
    for i, c in enumerate(s):
        v = 0 if c == '<' else int(c) if c.isdigit() else ord(c) - 55
        t += v * w[i % 3]
    return str(t % 10)

class Doc:
    def __init__(self, w, h, bg=(250, 250, 246)):
        self.img = Image.new('RGB', (w, h), bg); self.d = ImageDraw.Draw(self.img); self.lines = []
    def text(self, x, y, s, size=30, bold=False, mono=False, color=(20, 20, 25)):
        f = font(size, bold, mono); self.d.text((x, y), s, font=f, fill=color)
        b = self.d.textbbox((x, y), s, font=f)
        self.lines.append({'t': s, 'x': b[0], 'y': b[1], 'w': b[2] - b[0], 'h': b[3] - b[1]})
    def label(self, x, y, s, size=21):
        self.text(x, y, s, size, color=(90, 95, 110))
    def field(self, x, y, lab, val, size=30):
        self.label(x, y, lab); self.text(x, y + 30, val, size)
    def box(self, xy, fill=None, outline=(170, 175, 185)):
        self.d.rounded_rectangle(xy, 14, fill=fill, outline=outline, width=2)

samples = []
def save(doc, name, category, expect, variants=()):
    path = os.path.join(OUT, name + '.png'); doc.img.save(path)
    samples.append({'file': name + '.png', 'category': category, 'expect': expect, 'lines': doc.lines})
    for v in variants:
        img = doc.img.copy()
        if v == 'foto':
            img = img.resize((int(img.width * 0.72), int(img.height * 0.72)))
            img = img.rotate(3.2, expand=True, fillcolor=(120, 115, 105), resample=Image.BICUBIC)
            noise = Image.effect_noise(img.size, 18).convert('RGB')
            img = Image.blend(img, noise, 0.08).filter(ImageFilter.GaussianBlur(0.6))
            img.save(os.path.join(OUT, name + '_foto.jpg'), quality=62)
            samples.append({'file': name + '_foto.jpg', 'category': category, 'expect': expect})
        if v == 'deitada':
            img = img.rotate(90, expand=True)
            img.save(os.path.join(OUT, name + '_deitada.jpg'), quality=85)
            samples.append({'file': name + '_deitada.jpg', 'category': category, 'expect': expect})

# ================= CNH =================
c1 = cpf('390533447')
d = Doc(1600, 1050, (236, 244, 236))
d.text(60, 40, 'REPÚBLICA FEDERATIVA DO BRASIL', 26, True)
d.text(60, 78, 'CARTEIRA NACIONAL DE HABILITAÇÃO', 34, True, color=(20, 90, 50))
d.box((40, 140, 1560, 1010), outline=(120, 150, 120))
d.field(380, 170, 'NOME', 'ANA BEATRIZ SOUZA LIMA', 34)
d.field(380, 260, 'DOC. IDENTIDADE / ÓRG. EMISSOR / UF', '12345678 SSP SP')
d.field(380, 350, 'CPF', c1); d.field(900, 350, 'DATA NASCIMENTO', '14/03/1990')
d.label(380, 440, 'FILIAÇÃO'); d.text(380, 470, 'JOSÉ CARLOS LIMA'); d.text(380, 510, 'MARIA HELENA SOUZA LIMA')
d.field(380, 580, 'PERMISSÃO', ''); d.field(700, 580, 'ACC', ''); d.field(950, 580, 'CAT. HAB.', 'AB')
d.field(380, 680, 'Nº REGISTRO', '04567891234'); d.field(780, 680, 'VALIDADE', '20/08/2031'); d.field(1150, 680, '1ª HABILITAÇÃO', '05/06/2009')
d.field(380, 780, 'OBSERVAÇÕES', 'A')
d.field(380, 880, 'LOCAL', 'SÃO PAULO, SP'); d.field(900, 880, 'DATA EMISSÃO', '21/08/2021')
d.text(70, 960, 'DETRAN-SP', 24, True); d.text(1200, 960, 'SP987654321', 24)
d.box((70, 180, 340, 520), fill=(205, 215, 205))
save(d, 'cnh', 'cnh', {'number': '04567891234', 'expiresAt': '2031-08-20', 'issuedAt': '2021-08-21',
     'details.nome': 'Ana Beatriz Souza Lima', 'details.cpf': c1, 'details.nascimento': '1990-03-14',
     'details.primeira': '2009-06-05', 'details.classe': 'AB', 'details.renach': 'SP987654321', 'details.orgao': 'DETRAN/SP'},
     variants=('foto', 'deitada'))

# ================= RG =================
c2 = cpf('123456789')
d = Doc(1600, 1000, (240, 236, 246))
d.text(60, 40, 'REPÚBLICA FEDERATIVA DO BRASIL', 26, True)
d.text(60, 78, 'ESTADO DE SÃO PAULO · SECRETARIA DA SEGURANÇA PÚBLICA', 22)
d.text(60, 110, 'INSTITUTO DE IDENTIFICAÇÃO', 22)
d.field(60, 180, 'REGISTRO GERAL', '23.456.789-0', 34); d.field(700, 180, 'DATA DE EXPEDIÇÃO', '10/02/2015')
d.field(60, 290, 'NOME', 'RICARDO ALVES PEREIRA', 34)
d.label(60, 400, 'FILIAÇÃO'); d.text(60, 430, 'ANTONIO PEREIRA NETO'); d.text(60, 470, 'LUCIA ALVES PEREIRA')
d.field(60, 560, 'NATURALIDADE', 'CAMPINAS-SP'); d.field(700, 560, 'DATA DE NASCIMENTO', '22/11/1985')
d.field(60, 660, 'DOC. ORIGEM', 'CERT. NASC. LIVRO A-12 FLS 34'); d.field(700, 660, 'CPF', c2)
d.text(60, 780, 'SSP/SP', 26, True)
save(d, 'rg', 'identidade', {'number': '23.456.789-0', 'issuedAt': '2015-02-10', 'details.nome': 'Ricardo Alves Pereira',
     'details.cpf': c2, 'details.nascimento': '1985-11-22', 'details.naturalidade': 'Campinas-SP',
     'details.filiacao': 'Antonio Pereira Neto e Lucia Alves Pereira', 'details.orgao': 'SSP/SP', 'details.uf': 'SP'}, variants=('foto',))

# ================= CPF =================
c3 = cpf('529982247')
d = Doc(1240, 900, (255, 255, 255))
d.text(60, 50, 'RECEITA FEDERAL DO BRASIL', 28, True)
d.text(60, 100, 'COMPROVANTE DE INSCRIÇÃO E DE SITUAÇÃO CADASTRAL', 24, True)
d.text(60, 180, 'Nº do CPF: ' + c3, 28)
d.text(60, 240, 'Nome: FERNANDA COSTA RIBEIRO', 28)
d.text(60, 300, 'Data de Nascimento: 03/07/1992', 28)
d.text(60, 360, 'Situação Cadastral: REGULAR', 28)
d.text(60, 420, 'Data da Inscrição: anterior a 10/11/1990', 22)
d.text(60, 520, 'Comprovante emitido em: 02/09/2024 às 10:15:22', 22)
save(d, 'cpf', 'cpf', {'number': c3, 'issuedAt': '2024-09-02', 'details.nome': 'Fernanda Costa Ribeiro',
     'details.nascimento': '1992-07-03', 'details.situacao': 'Regular'})

# ================= Certidão =================
d = Doc(1240, 1500, (252, 250, 244))
d.text(330, 60, 'REPÚBLICA FEDERATIVA DO BRASIL', 28, True)
d.text(200, 110, 'REGISTRO CIVIL DAS PESSOAS NATURAIS', 30, True)
d.text(380, 170, 'CERTIDÃO DE NASCIMENTO', 34, True)
d.field(60, 260, 'NOME', 'PEDRO HENRIQUE MOURA SANTOS', 32)
d.field(60, 360, 'MATRÍCULA', '104539 01 55 2012 1 00012 345 0001234 56')
d.field(60, 460, 'DATA DE NASCIMENTO', '08/04/2012'); d.field(640, 460, 'SEXO', 'MASCULINO')
d.label(60, 560, 'FILIAÇÃO'); d.text(60, 590, 'MARCOS MOURA SANTOS e CLARA MOURA SANTOS')
d.text(60, 680, 'Livro: A-123     Folha: 45     Termo: 6789', 28)
d.text(60, 1100, 'Cartório do 2º Ofício de Registro Civil de Belo Horizonte - MG', 24)
d.text(60, 1150, 'Data de emissão: 12/07/2012', 26)
save(d, 'certidao', 'certidoes', {'number': '104539 01 55 2012 1 00012 345 0001234 56', 'issuedAt': '2012-07-12',
     'details.tipo': 'Nascimento', 'details.nome': 'Pedro Henrique Moura Santos', 'details.livro': 'A-123',
     'details.folha': '45', 'details.termo': '6789'}, variants=('foto',))

# ================= Passaporte =================
num = 'FX123456<'; birth = '880517'; exp = '330211'
l1 = 'P<BRAOLIVEIRA<<CAMILA<ROCHA'.ljust(44, '<')
l2 = num + mrz_cd(num) + 'BRA' + birth + mrz_cd(birth) + 'F' + exp + mrz_cd(exp) + '<' * 14 + '0'
l2 = l2 + mrz_cd(l2[0:10] + l2[13:20] + l2[21:43])
assert len(l1) == 44 and len(l2) == 44, (len(l1), len(l2))
d = Doc(1600, 1100, (232, 238, 246))
d.text(60, 40, 'REPÚBLICA FEDERATIVA DO BRASIL', 26, True); d.text(60, 78, 'PASSAPORTE / PASSPORT', 30, True)
d.field(420, 150, 'TIPO / TYPE', 'P'); d.field(700, 150, 'PAÍS EMISSOR / ISSUING COUNTRY', 'BRA'); d.field(1150, 150, 'PASSAPORTE Nº / PASSPORT No.', 'FX123456')
d.field(420, 250, 'SOBRENOME / SURNAME', 'OLIVEIRA'); d.field(420, 340, 'NOME / GIVEN NAMES', 'CAMILA ROCHA')
d.field(420, 430, 'NACIONALIDADE / NATIONALITY', 'BRASILEIRO(A)'); d.field(1000, 430, 'DATA DE NASCIMENTO / DATE OF BIRTH', '17 MAI/MAY 1988')
d.field(420, 520, 'DATA DE EXPEDIÇÃO / DATE OF ISSUE', '12 FEV/FEB 2023'); d.field(1000, 520, 'VALIDADE / DATE OF EXPIRY', '11 FEV/FEB 2033')
d.box((60, 150, 380, 600), fill=(205, 212, 225))
d.text(60, 900, l1, 40, mono=True); d.text(60, 960, l2, 40, mono=True)
save(d, 'passaporte', 'passaporte', {'number': 'FX123456', 'expiresAt': '2033-02-11', 'details.nascimento': '1988-05-17',
     'details.nome': 'Camila Rocha Oliveira', 'details.pais': 'Brasil', 'details.nacionalidade': 'Brasileira', 'details.tipo': 'Comum'}, variants=('foto',))

# ================= Título de eleitor =================
d = Doc(1600, 900, (245, 245, 238))
d.text(60, 40, 'JUSTIÇA ELEITORAL', 28, True); d.text(60, 85, 'TÍTULO ELEITORAL', 34, True)
d.field(60, 170, 'NOME DO ELEITOR', 'LUCAS GABRIEL FERREIRA', 32)
d.field(60, 270, 'DATA DE NASCIMENTO', '30/01/2001'); d.field(600, 270, 'INSCRIÇÃO', '1234 5678 0191')
d.label(60, 370, 'ZONA        SEÇÃO'); d.text(60, 400, '0246        0135')
d.field(600, 370, 'MUNICÍPIO / UF', 'CAMPINAS/SP'); d.field(1100, 370, 'DATA DE EMISSÃO', '15/03/2019')
save(d, 'titulo', 'eleitor', {'number': '1234 5678 0191', 'issuedAt': '2019-03-15', 'details.nome': 'Lucas Gabriel Ferreira',
     'details.nascimento': '2001-01-30', 'details.zona': '0246', 'details.secao': '0135', 'details.municipio': 'Campinas/SP'})

# ================= CRLV =================
d = Doc(1600, 1100, (246, 244, 236))
d.text(60, 40, 'CERTIFICADO DE REGISTRO E LICENCIAMENTO DE VEÍCULO', 30, True); d.text(60, 85, 'SENATRAN · CRLV DIGITAL', 22)
d.field(60, 160, 'CÓDIGO RENAVAM', '01234567890'); d.field(600, 160, 'PLACA', 'BRA2E19', 36); d.field(1000, 160, 'EXERCÍCIO', '2025')
d.field(60, 260, 'ANO FABRICAÇÃO / ANO MODELO', '2019/2020'); d.field(600, 260, 'Nº DO CRV', '234567891011')
d.field(60, 360, 'MARCA / MODELO / VERSÃO', 'VW/GOL 1.0L MC4'); d.field(800, 360, 'COR PREDOMINANTE', 'PRATA')
d.field(60, 460, 'CHASSI', '9BWAB45U3KT012345'); d.field(800, 460, 'COMBUSTÍVEL', 'ALCOOL/GASOLINA')
d.field(60, 560, 'NOME', 'CARLOS EDUARDO PEREIRA'); d.field(800, 560, 'CPF / CNPJ', cpf('987654321'))
d.field(60, 660, 'LOCAL', 'CAMPINAS SP'); d.field(800, 660, 'DATA', '15/01/2025')
save(d, 'crlv', 'veiculos', {'details.placa': 'BRA2E19', 'details.renavam': '01234567890', 'details.chassi': '9BWAB45U3KT012345',
     'details.ano': '2019/2020', 'details.modelo': 'VW/GOL 1.0L MC4', 'details.proprietario': 'Carlos Eduardo Pereira',
     'number': '234567891011'}, variants=('foto',))

# ================= Cartão SUS =================
cn = cns('70000000001')
d = Doc(1400, 820, (232, 242, 250))
d.text(60, 40, 'MINISTÉRIO DA SAÚDE · SUS', 26, True); d.text(60, 85, 'CARTÃO NACIONAL DE SAÚDE', 34, True)
d.field(60, 200, 'NOME', 'HELENA MARQUES DUARTE', 32)
d.field(60, 300, 'DATA DE NASCIMENTO', '19/09/1978'); d.field(600, 300, 'SEXO', 'F')
d.label(60, 420, 'NÚMERO CNS'); d.text(60, 455, cn, 40, True)
save(d, 'sus', 'saude', {'details.cns': cn, 'number': cn, 'details.nome': 'Helena Marques Duarte', 'details.nascimento': '1978-09-19'})

# ================= Conta de luz =================
d = Doc(1240, 1300, (255, 255, 255))
d.text(60, 50, 'COMPANHIA FICTÍCIA DE ENERGIA S.A.', 26, True); d.text(60, 95, 'CONTA DE ENERGIA ELÉTRICA', 32, True)
d.field(60, 180, 'NOME DO CLIENTE', 'BRUNO TAVARES MENDES')
d.text(60, 280, 'RUA DAS FLORES, 123 - APTO 45', 28); d.text(60, 320, 'JARDIM PAULISTA - SÃO PAULO - SP', 28); d.text(60, 360, 'CEP 01234-567', 28)
d.field(60, 440, 'INSTALAÇÃO', '7654321'); d.field(500, 440, 'REFERÊNCIA', 'OUT/2025'); d.field(860, 440, 'VENCIMENTO', '10/11/2025')
d.field(60, 540, 'CONSUMO (kWh)', '215'); d.field(500, 540, 'DATA DE EMISSÃO', '20/10/2025')
d.field(60, 640, 'TOTAL A PAGAR', 'R$ 187,45', 36)
save(d, 'conta_luz', 'comprovantes', {'details.titular': 'Bruno Tavares Mendes', 'details.cep': '01234-567', 'details.referencia': '10/2025',
     'details.valor': 'R$ 187,45', 'number': '7654321', 'issuedAt': '2025-10-20'}, variants=('foto',))

# ================= Diploma =================
d = Doc(1754, 1240, (253, 251, 243))
d.text(520, 70, 'UNIVERSIDADE FEDERAL DE EXEMPLO', 38, True)
d.text(790, 150, 'DIPLOMA', 48, True)
d.text(120, 290, 'O Reitor da Universidade Federal de Exemplo, no uso de suas atribuições,', 30)
d.text(120, 340, 'confere a JULIANA MARTINS ROCHA o título de Bacharel em Engenharia Civil,', 30)
d.text(120, 390, 'por ter concluído o curso em 15/12/2019.', 30)
d.text(120, 520, 'Expedido em 10/03/2020', 28)
d.text(120, 580, 'Registro nº 45678', 28)
save(d, 'diploma', 'educacao', {'details.instituicao': 'Universidade Federal de Exemplo', 'details.nome': 'Juliana Martins Rocha',
     'details.curso': 'Engenharia Civil', 'details.conclusao': '2019-12-15', 'issuedAt': '2020-03-10', 'number': '45678'})

# ================= Carteira de trabalho =================
c4 = cpf('111444777')
d = Doc(1240, 1000, (255, 255, 255))
d.text(60, 50, 'CARTEIRA DE TRABALHO DIGITAL', 30, True); d.text(60, 100, 'CONTRATO DE TRABALHO', 26, True)
d.field(60, 180, 'NOME', 'MARIANA SILVA COSTA'); d.field(700, 180, 'CPF', c4)
d.field(60, 280, 'PIS/PASEP', '123.45678.90-1')
d.field(60, 380, 'EMPREGADOR', 'EMPRESA EXEMPLO LTDA'); d.field(700, 380, 'CNPJ', '12.345.678/0001-90')
d.field(60, 480, 'CARGO', 'ANALISTA DE SISTEMAS'); d.field(700, 480, 'DATA DE ADMISSÃO', '03/02/2020')
save(d, 'ctps', 'trabalho', {'details.nome': 'Mariana Silva Costa', 'details.cpf': c4, 'details.pis': '123.45678.90-1',
     'details.empresa': 'EMPRESA EXEMPLO LTDA', 'details.cargo': 'ANALISTA DE SISTEMAS', 'details.admissao': '2020-02-03'})

# ================= Apólice =================
d = Doc(1240, 1000, (255, 255, 255))
d.text(60, 50, 'SEGURADORA EXEMPLO S.A.', 30, True); d.text(60, 100, 'APÓLICE DE SEGURO AUTOMÓVEL', 28, True)
d.field(60, 180, 'Nº DA APÓLICE', '1234567890'); d.field(600, 180, 'SEGURADO', 'RAFAEL NUNES BARBOSA')
d.field(60, 280, 'VIGÊNCIA', '01/02/2025 a 01/02/2026')
d.field(60, 380, 'ITEM SEGURADO', 'HONDA CIVIC EXL 2021')
d.text(60, 480, 'Assistência 24h: 0800 123 4567', 26)
save(d, 'apolice', 'seguros', {'number': '1234567890', 'details.segurado': 'Rafael Nunes Barbosa', 'issuedAt': '2025-02-01',
     'expiresAt': '2026-02-01', 'details.bem': 'HONDA CIVIC EXL 2021', 'details.contato': '0800 123 4567', 'details.seguradora': 'SEGURADORA EXEMPLO S.A.'})

# ================= IRPF =================
c5 = cpf('222333444')
d = Doc(1240, 1000, (255, 255, 255))
d.text(60, 50, 'DECLARAÇÃO DE AJUSTE ANUAL', 30, True); d.text(60, 100, 'IMPOSTO SOBRE A RENDA - PESSOA FÍSICA', 26, True)
d.text(60, 150, 'EXERCÍCIO 2025   ANO-CALENDÁRIO 2024', 26)
d.field(60, 230, 'NOME', 'PAULO ROBERTO ALMEIDA'); d.field(700, 230, 'CPF', c5)
d.field(60, 330, 'IMPOSTO A RESTITUIR', 'R$ 1.234,56')
d.text(60, 430, 'RECEITA FEDERAL DO BRASIL', 24)
save(d, 'irpf', 'financas', {'details.nome': 'Paulo Roberto Almeida', 'details.cpf': c5, 'details.ano': '2024', 'details.valor': 'R$ 1.234,56'})

# ---------- gravação ----------
exp = [{k: v for k, v in s.items() if k != 'lines'} for s in samples]
json.dump(exp, open(os.path.join(OUT, 'expected.json'), 'w'), ensure_ascii=False, indent=1)
json.dump([s for s in samples if 'lines' in s], open(os.path.join(ROOT, 'tools/amostras-linhas.json'), 'w'), ensure_ascii=False)
print(len(samples), 'amostras geradas em', OUT)
