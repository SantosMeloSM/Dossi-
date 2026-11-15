#!/usr/bin/env bash
# Teste de fumaça no emulador: instala, abre, cria um cofre e verifica crashes.
set -u
OUT=dist; mkdir -p $OUT
LOG=$OUT/teste-emulador.txt; : > $LOG
APK=$(ls android/app/build/outputs/apk/debug/*.apk | head -1)
PKG=br.com.santosmelo.dossie
ok=0; fail=0
step() { echo "$1" | tee -a $LOG; }
pass() { step "  ✔ $1"; ok=$((ok+1)); }
bad()  { step "  ✘ $1"; fail=$((fail+1)); }
dump() { adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml ui.xml >/dev/null 2>&1; }
has()  { dump; python3 .github/scripts/uifind.py ui.xml "$1" >/dev/null 2>&1; }
waitfor() { for i in $(seq 1 ${2:-30}); do has "$1" && return 0; sleep 1; done; return 1; }
screen() { dump; python3 -c "
import xml.etree.ElementTree as E,sys
t=[n.get('text') or n.get('content-desc') for n in E.parse('ui.xml').getroot().iter('node')]
print('    tela: '+' | '.join(x for x in t if x)[:900])" >> $LOG 2>/dev/null; }
tap()  { local xy; xy=$(python3 .github/scripts/uifind.py ui.xml "$1") || return 1; adb shell input tap $xy; }

step "Dossiê – teste automático no emulador Android (API 34)"
step "APK: $(basename $APK) ($(du -h $APK | cut -f1))"
adb logcat -G 16M >/dev/null 2>&1
adb install -r "$APK" >/dev/null && pass "APK instalado" || bad "falha ao instalar"
adb logcat -c
adb shell am start -W -n $PKG/.MainActivity >/dev/null && pass "app iniciado" || bad "app não iniciou"

if waitfor "Crie a senha" 45; then pass "tela de criação do cofre exibida"; else bad "tela inicial não apareceu"; fi
tap "@EditText:0" && sleep 1 && adb shell input text "SenhaTeste123" && sleep 1
dump; tap "@EditText:1" && sleep 1 && adb shell input text "SenhaTeste123" && sleep 1
screen
adb shell input keyevent 66; sleep 2   # Enter envia o formulário
step "  (enviado com Enter)"; screen
if waitfor "recuperação" 60; then pass "cofre criado e chave de recuperação exibida"; else bad "chave de recuperação não apareceu"; screen; fi
dump; tap "Guardei" && sleep 1; dump; tap "Concluir" && sleep 2
if waitfor "Cadastro rápido" 20; then pass "painel inicial carregado"; else bad "painel inicial não carregou"; screen; fi
dump; if tap "CNH"; then sleep 2; waitfor "Salvar" 15 && pass "editor de documento abriu" || bad "editor não abriu"; else bad "modelo CNH não encontrado"; fi
dump; tap "Salvar" && sleep 3
waitfor "CNH" 10 && pass "documento salvo" || bad "documento não apareceu"

# Bloquear e reabrir com a senha
adb shell input keyevent 4; sleep 1
adb shell am force-stop $PKG; sleep 1
adb shell am start -W -n $PKG/.MainActivity >/dev/null
if waitfor "Bem-vindo de volta" 40; then pass "reabertura pede a senha (dados persistidos)"; else bad "tela de login não apareceu após reabrir"; fi
dump; tap "@EditText:0" && adb shell input text "SenhaTeste123" && adb shell input keyevent 66
if waitfor "Recentes" 40; then pass "desbloqueio com senha funcionou"; else bad "desbloqueio falhou"; fi

# Leitura automática com OCR real (ML Kit) nas amostras fictícias
step ""
step "Leitura automática (OCR real no aparelho) com documentos fictícios:"
adb shell am force-stop $PKG; sleep 1
adb shell am start -n $PKG/.MainActivity --ez selftest true >/dev/null
for i in $(seq 1 450); do adb logcat -d -s DossieJS:I | grep -q "SELFTEST DONE" && break; sleep 2; done
adb logcat -d -s DossieJS:I | grep "SELFTEST" | sed 's/^.*SELFTEST /  /' > $OUT/ocr-resultados.txt
cat $OUT/ocr-resultados.txt >> $LOG
if grep -q "DONE" $OUT/ocr-resultados.txt; then pass "autoteste de leitura concluído: $(grep DONE $OUT/ocr-resultados.txt | sed 's/.*DONE //') campos corretos"; else bad "autoteste de leitura não terminou"; fi

# Crashes e erros
adb logcat -d > $OUT/logcat-completo.txt
if grep -q "FATAL EXCEPTION" $OUT/logcat-completo.txt; then bad "crash encontrado no logcat"; grep -A15 "FATAL EXCEPTION" $OUT/logcat-completo.txt >> $LOG; else pass "nenhum crash (FATAL EXCEPTION) no logcat"; fi
grep -E "CONSOLE" $OUT/logcat-completo.txt | head -40 > $OUT/console-js.txt || true
grep -iE "CONSOLE.*(error|uncaught|exception)" $OUT/logcat-completo.txt | head -20 > $OUT/erros-js.txt || true
grep -iE "dossie|chromium" $OUT/logcat-completo.txt | grep -E " [EW] " | head -40 > $OUT/logcat-avisos.txt || true
if [ -s $OUT/erros-js.txt ]; then bad "erros de JavaScript no console (ver erros-js.txt)"; cat $OUT/erros-js.txt >> $LOG; else pass "nenhum erro de JavaScript"; fi
adb shell pidof $PKG >/dev/null && pass "processo ainda vivo ao final" || bad "processo morreu"
step ""
step "Resultado: $ok ok, $fail falha(s)"
rm -f $OUT/logcat-completo.txt
echo "$fail" > $OUT/falhas.txt
exit 0
