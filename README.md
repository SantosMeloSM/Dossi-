# Dossiê 2

Cofre pessoal de documentos: RG, CNH, CPF, certidões, passaporte e o que mais importar, **cifrados no próprio aparelho** e acessíveis offline. Reescrito do zero a partir do Dossiê 1.6, com arquitetura nova e mais recursos.

- `web/`: o app (PWA em HTML/CSS/JS puro, sem dependências nem etapa de build)
- `android/`: casca nativa em Kotlin (WebView + Keystore + seletores do sistema)
- `.github/workflows/`: build do APK e publicação da PWA no GitHub Pages

## Recursos

### Herdados do 1.6 (todos mantidos)
- Cofre com senha, AES‑256‑GCM, chave derivada por PBKDF2‑SHA256
- 10 categorias com modelos de cadastro e campos específicos (RENACH, cartório, placa…)
- Número, emissão, validade, observações, capa do documento
- Painel com estatísticas, pastas por categoria, favoritos e vencimentos (≤ 30 dias)
- Busca por nome, número e campos; ordenação; grade ou lista
- Prévia de imagens e miniatura automática de PDFs escaneados
- Copiar qualquer campo, compartilhar, baixar, editar e excluir
- Backup cifrado (exportar e restaurar) e "apagar tudo"
- Bloqueio automático por inatividade, desbloqueio por digital/PIN (Android)
- Funciona offline (service worker)

### Novidades
| Área | O que há de novo |
|---|---|
| **Segurança** | Chave de dados separada da senha (envelope): **trocar a senha** sem recifrar nada · **chave de recuperação** para quem esquece a senha · proteção contra força bruta (pausas progressivas) · metadados vinculados ao id (AAD) · 310 mil iterações PBKDF2 · CSP restritiva · APK **sem permissão de internet** · bloqueio de capturas de tela · bloquear ao sair do app |
| **Documentos** | **Vários anexos** por documento (frente, verso, páginas) com rótulos e escolha da capa · **câmera** · colar imagens (Ctrl+V) · arrastar e soltar · registros só com dados, sem arquivo · **etiquetas** · validação de **CPF** e formatação de placa · atalhos de validade (+1/+5/+10 anos) |
| **Organização** | **Pessoas/família**: cada documento pertence a alguém, com filtro próprio · **categorias personalizadas** com campos próprios · 4 categorias novas (Passaporte, Título de eleitor, Finanças, Seguros e garantias) · filtros por categoria, pessoa, situação e etiqueta · **lixeira** com restauração |
| **Prazos** | Linha do tempo de vencimentos (vencidos, 7 dias, 30 dias, 3 meses…) · antecedência configurável (7–90 dias) · **exportar para a agenda (.ics)** com lembretes · notificações no navegador |
| **Privacidade** | Modo "ocultar números" (toque para revelar) · desfocar miniaturas |
| **Visualização** | Visualizador em tela cheia com zoom e rotação · PDF dentro do app (desktop) · "abrir com" outro app no Android · compartilhar a **ficha em texto** |
| **Backup** | Importar mesclando ou substituindo · **lê backups do Dossiê 1.x** · lembrete de backup · uso de armazenamento |
| **Interface** | Tema claro/escuro/sistema · layout responsivo (barra inferior no celular, lateral no desktop) · atalhos `/`, `N`, `L`, `P` |

## Modelo de criptografia

```
senha ──PBKDF2(310k)──► KEK₁ ─┐
chave de recuperação ──► KEK₂ ─┼─► embrulham a DEK (AES‑256 aleatória)
Android Keystore (biometria) ──┘
DEK ──AES‑GCM──► metadados (AAD = id do doc) e cada anexo (AAD = doc + anexo)
```
Tudo fica no IndexedDB do aparelho. O backup copia os registros já cifrados; só abre com a senha vigente na hora em que foi feito.

## Rodar

**Web:** sirva a pasta `web/` por HTTPS ou `localhost` (ex.: `cd web && python3 -m http.server`). Para publicar, ative o GitHub Pages (Settings → Pages → Source: GitHub Actions) e faça push na `main`.

**Android:** o workflow "Android APK" gera `dossie-apk` (debug) a cada push. Localmente: `cd android && gradle assembleDebug` (Android SDK 34, JDK 17). Para publicar na loja, configure `signingConfigs` e use `assembleRelease`.

> O Dossiê 2 usa um banco novo (`dossie-vault`). Para trazer os dados do 1.6: no app antigo, exporte o backup; no novo, toque em **Restaurar backup** e use a senha antiga.
