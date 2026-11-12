#!/usr/bin/env bash
# Teste de fumaça no emulador: instala, abre, cria um cofre e verifica crashes.
set -u
OUT=dist; mkdir -p $OUT
LOG=$OUT/teste-emulador.txt
APK=$(ls android/app/build/outputs/apk/debug/*.apk | head -1)
PKG=br.com.santosmelo.dossie
ok=0; fail=0
step() { echo "$1" | tee -a $LOG; }
pass() { step "  ✔ $1"; ok=$((ok+1)); }
bad()  { step "  ✘ $1"; fail=$((fail+1)); }
dump() { adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml ui.xml >/dev/null 2>&1; }
has()  { dump; python3 .github/scripts/uifind.py ui.xml "$1" >/dev/null 2>&1; }
waitfor() { for i in $(seq 1 ${2:-30}); do has "$1" && return 0; sleep 1; done; return 1; }
tap()  { local xy; xy=$(python3 .github/scripts/uifind.py ui.xml "$1") || return 1; adb shell input tap $xy; }

step "Dossiê – teste automático no emulador Android (API 34)"
step "APK: $(basename $APK) ($(du -h $APK | cut -f1))"
adb install -r "$APK" >/dev/null && pass "APK instalado" || bad "falha ao instalar"
adb logcat -c
adb shell am start -W -n $PKG/.MainActivity >/dev/null && pass "app iniciado" || bad "app não iniciou"

if waitfor "Crie a senha" 45; then pass "tela de criação do cofre exibida"; else bad "tela inicial não apareceu"; fi
tap "@EditText:0" && adb shell input text "SenhaTeste123" && sleep 1
dump; tap "@EditText:1" && adb shell input text "SenhaTeste123" && sleep 1
adb shell input keyevent 111; sleep 1   # fecha teclado
dump; if tap "Criar meu cofre"; then pass "botão criar cofre tocado"; else bad "botão criar cofre não encontrado"; fi
if waitfor "recuperação" 40; then pass "cofre criado e chave de recuperação exibida"; else bad "chave de recuperação não apareceu"; fi
dump; tap "Guardei" && sleep 1; dump; tap "Concluir" && sleep 2
if waitfor "Cadastro rápido" 20; then pass "painel inicial carregado"; else bad "painel inicial não carregou"; fi
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

# Crashes e erros
adb logcat -d > $OUT/logcat-completo.txt
if grep -q "FATAL EXCEPTION" $OUT/logcat-completo.txt; then bad "crash encontrado no logcat"; grep -A15 "FATAL EXCEPTION" $OUT/logcat-completo.txt >> $LOG; else pass "nenhum crash (FATAL EXCEPTION) no logcat"; fi
grep -E "CONSOLE.*(Error|Uncaught)" $OUT/logcat-completo.txt | head -20 > $OUT/erros-js.txt || true
if [ -s $OUT/erros-js.txt ]; then bad "erros de JavaScript no console (ver erros-js.txt)"; cat $OUT/erros-js.txt >> $LOG; else pass "nenhum erro de JavaScript"; fi
adb shell pidof $PKG >/dev/null && pass "processo ainda vivo ao final" || bad "processo morreu"
step ""
step "Resultado: $ok ok, $fail falha(s)"
rm -f $OUT/logcat-completo.txt
echo "$fail" > $OUT/falhas.txt
exit 0
