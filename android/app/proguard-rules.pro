# Métodos expostos ao JavaScript precisam manter os nomes.
-keepclassmembers class br.com.santosmelo.dossie.MainActivity$Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
