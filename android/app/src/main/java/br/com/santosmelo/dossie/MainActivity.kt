package br.com.santosmelo.dossie

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Casca nativa do Dossiê: um WebView servindo o app web a partir dos assets
 * (origem HTTPS local, sem rede), mais recursos que a web não oferece:
 *  - desbloqueio por digital/PIN com a chave do cofre protegida pelo Android Keystore
 *  - salvar arquivos pelo seletor do sistema, compartilhar e abrir em outros apps
 *  - câmera, botão voltar e bloqueio de capturas de tela
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private val prefs by lazy { getSharedPreferences("dossie", MODE_PRIVATE) }
    private val assetLoader by lazy {
        WebViewAssetLoader.Builder()
            .addPathHandler("/app/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
    }

    // ---- seleção de arquivos / câmera
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var cameraUri: Uri? = null
    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(r.resultCode, r.data))
        fileCallback = null
    }
    private val takePicture = registerForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val uri = cameraUri
        fileCallback?.onReceiveValue(if (ok && uri != null) arrayOf(uri) else null)
        fileCallback = null
    }

    // ---- transferências de arquivos decifrados (JS -> nativo)
    private var transferFile: File? = null
    private var transferStream: FileOutputStream? = null
    private var transferName = "documento"
    private var transferMime = "application/octet-stream"
    private var pendingSave: File? = null
    private val createDocument = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val src = pendingSave
        pendingSave = null
        val uri = r.data?.data
        if (src == null) return@registerForActivityResult
        if (r.resultCode != RESULT_OK || uri == null) { src.delete(); return@registerForActivityResult }
        try {
            contentResolver.openOutputStream(uri, "w")?.use { out -> src.inputStream().use { it.copyTo(out) } }
                ?: throw IllegalStateException("destino indisponível")
            emit("saved", "")
        } catch (e: Exception) {
            emit("transfer-error", "Não foi possível salvar o arquivo.")
        } finally { src.delete() }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        applySecureFlag(prefs.getBoolean("secure", true))
        cleanCache()

        web = WebView(this)
        setContentView(web)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            setSupportMultipleWindows(false)
            mediaPlaybackRequiresUserGesture = true
        }
        web.overScrollMode = WebView.OVER_SCROLL_NEVER
        web.addJavascriptInterface(Bridge(), "DossieNative")

        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                if (request.url.host != ASSET_HOST) return WebResourceResponse("text/plain", "utf-8", 403, "Forbidden", null, null)
                return assetLoader.shouldInterceptRequest(request.url)
            }
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                request.url.host != ASSET_HOST
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    if (params.isCaptureEnabled) {
                        val dir = File(cacheDir, "camera").apply { mkdirs() }
                        val photo = File(dir, "foto-${System.currentTimeMillis()}.jpg")
                        val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.files", photo)
                        cameraUri = uri
                        takePicture.launch(uri)
                    } else {
                        val intent = params.createIntent()
                        if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                        pickFiles.launch(intent)
                    }
                    true
                } catch (e: Exception) {
                    fileCallback = null
                    false
                }
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript("(window.dossieHandleBack ? window.dossieHandleBack() : false)") { handled ->
                    if (handled != "true") moveTaskToBack(true)
                }
            }
        })

        if (savedInstanceState == null) web.loadUrl("https://$ASSET_HOST/app/index.html")
        else web.restoreState(savedInstanceState)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onDestroy() {
        cancelTransfer()
        web.destroy()
        super.onDestroy()
    }

    /** Remove cópias decifradas temporárias de sessões anteriores. */
    private fun cleanCache() {
        listOf("shared", "camera", "transfer").forEach { File(cacheDir, it).deleteRecursively() }
    }

    private fun applySecureFlag(on: Boolean) {
        if (on) window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }

    private fun emit(type: String, payload: String) = runOnUiThread {
        web.evaluateJavascript(
            "window.__dossieNative && window.__dossieNative.emit(${JSONObject.quote(type)}, ${JSONObject.quote(payload)})", null
        )
    }

    private fun safeName(name: String) =
        name.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "_").trim().take(120).ifEmpty { "documento" }

    private fun safeMime(mime: String) =
        if (Regex("^[a-z0-9.+-]+/[a-z0-9.+-]+$", RegexOption.IGNORE_CASE).matches(mime)) mime else "application/octet-stream"

    private fun cancelTransfer() {
        runCatching { transferStream?.close() }
        transferFile?.delete()
        transferStream = null
        transferFile = null
    }

    // ================================================================= biometria
    private val authenticators = BIOMETRIC_STRONG or DEVICE_CREDENTIAL

    private fun biometricAvailable() =
        BiometricManager.from(this).canAuthenticate(authenticators) == BiometricManager.BIOMETRIC_SUCCESS

    private fun keyStore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun newKey(): SecretKey {
        runCatching { keyStore().deleteEntry(KEY_ALIAS) }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUserAuthenticationRequired(true)
                .setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
                .setInvalidatedByBiometricEnrollment(true)
                .build()
        )
        return gen.generateKey()
    }

    private fun clearBiometric() {
        prefs.edit().remove("bio_iv").remove("bio_ct").apply()
        runCatching { keyStore().deleteEntry(KEY_ALIAS) }
    }

    private fun prompt(title: String, cipher: Cipher, onSuccess: (Cipher) -> Unit) {
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle("Use a digital ou o bloqueio de tela do aparelho")
            .setAllowedAuthenticators(authenticators)
            .build()
        BiometricPrompt(this, ContextCompat.getMainExecutor(this), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                val c = result.cryptoObject?.cipher
                if (c == null) emit("biometric-error", "Autenticação sem chave criptográfica.") else onSuccess(c)
            }
            override fun onAuthenticationError(code: Int, msg: CharSequence) {
                if (code != BiometricPrompt.ERROR_USER_CANCELED && code != BiometricPrompt.ERROR_NEGATIVE_BUTTON && code != BiometricPrompt.ERROR_CANCELED)
                    emit("biometric-error", msg.toString())
            }
        }).authenticate(info, BiometricPrompt.CryptoObject(cipher))
    }

    private fun enableBiometric(secretB64: String) {
        val secret = Base64.decode(secretB64, Base64.NO_WRAP)
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, newKey()) }
            prompt("Ativar desbloqueio do Dossiê", cipher) { c ->
                try {
                    val ct = c.doFinal(secret)
                    prefs.edit()
                        .putString("bio_iv", Base64.encodeToString(c.iv, Base64.NO_WRAP))
                        .putString("bio_ct", Base64.encodeToString(ct, Base64.NO_WRAP))
                        .apply()
                    emit("biometric-enabled", "")
                } catch (e: Exception) {
                    emit("biometric-error", "Falha ao proteger a chave.")
                } finally { secret.fill(0) }
            }
        } catch (e: Exception) {
            secret.fill(0)
            emit("biometric-error", "Configure digital, PIN ou senha no Android.")
        }
    }

    private fun requestBiometric() {
        val iv = prefs.getString("bio_iv", null)
        val ct = prefs.getString("bio_ct", null)
        if (iv == null || ct == null) return
        try {
            val key = keyStore().getKey(KEY_ALIAS, null) as? SecretKey ?: throw KeyPermanentlyInvalidatedException()
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
                init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
            }
            prompt("Desbloquear Dossiê", cipher) { c ->
                try {
                    val plain = c.doFinal(Base64.decode(ct, Base64.NO_WRAP))
                    emit("biometric-secret", Base64.encodeToString(plain, Base64.NO_WRAP))
                    plain.fill(0)
                } catch (e: Exception) {
                    emit("biometric-error", "Não foi possível ler a chave protegida.")
                }
            }
        } catch (e: KeyPermanentlyInvalidatedException) {
            clearBiometric()
            emit("biometric-invalidated", "")
        } catch (e: Exception) {
            emit("biometric-error", "Biometria indisponível. Use a senha.")
        }
    }

    // ================================================================= ponte JS
    inner class Bridge {
        @JavascriptInterface fun isBiometricAvailable(): Boolean = biometricAvailable()
        @JavascriptInterface fun isBiometricEnabled(): Boolean = prefs.contains("bio_ct")
        @JavascriptInterface fun enableBiometric(secretB64: String) = runOnUiThread { this@MainActivity.enableBiometric(secretB64) }
        @JavascriptInterface fun disableBiometric() { clearBiometric(); emit("biometric-disabled", "") }
        @JavascriptInterface fun requestBiometric() = runOnUiThread { this@MainActivity.requestBiometric() }
        @JavascriptInterface fun setSecureScreen(on: Boolean) {
            prefs.edit().putBoolean("secure", on).apply()
            runOnUiThread { applySecureFlag(on) }
        }

        @JavascriptInterface fun beginTransfer(name: String, mime: String): Boolean {
            if (transferStream != null || pendingSave != null) return false
            return try {
                transferName = safeName(name)
                transferMime = safeMime(mime)
                val dir = File(cacheDir, "transfer").apply { mkdirs() }
                transferFile = File(dir, "t-${System.nanoTime()}")
                transferStream = FileOutputStream(transferFile)
                true
            } catch (e: Exception) { cancelTransfer(); false }
        }

        @JavascriptInterface fun appendTransfer(chunk: String): Boolean = try {
            transferStream!!.write(Base64.decode(chunk, Base64.NO_WRAP)); true
        } catch (e: Exception) { false }

        @JavascriptInterface fun cancelTransfer() = this@MainActivity.cancelTransfer()

        @JavascriptInterface fun finishTransfer(mode: String): Boolean {
            val file = transferFile ?: return false
            return try {
                transferStream?.close()
                transferStream = null
                transferFile = null
                when (mode) {
                    "save" -> {
                        pendingSave = file
                        runOnUiThread {
                            try {
                                createDocument.launch(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                                    addCategory(Intent.CATEGORY_OPENABLE)
                                    type = transferMime
                                    putExtra(Intent.EXTRA_TITLE, transferName)
                                })
                            } catch (e: ActivityNotFoundException) {
                                pendingSave = null; file.delete(); emit("transfer-error", "Nenhum app para salvar arquivos.")
                            }
                        }
                    }
                    "share", "open" -> {
                        val dir = File(cacheDir, "shared").apply { mkdirs() }
                        val out = File(dir, transferName)
                        if (!file.renameTo(out)) { file.copyTo(out, overwrite = true); file.delete() }
                        val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.files", out)
                        val intent = if (mode == "share") Intent(Intent.ACTION_SEND).apply {
                            type = transferMime; putExtra(Intent.EXTRA_STREAM, uri)
                        } else Intent(Intent.ACTION_VIEW).apply { setDataAndType(uri, transferMime) }
                        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        runOnUiThread {
                            try {
                                startActivity(Intent.createChooser(intent, if (mode == "share") "Compartilhar" else "Abrir com"))
                            } catch (e: ActivityNotFoundException) {
                                emit("transfer-error", "Nenhum app compatível encontrado.")
                            }
                        }
                    }
                    else -> { file.delete(); return false }
                }
                true
            } catch (e: Exception) { file.delete(); false }
        }

        @JavascriptInterface fun shareText(title: String, text: String) = runOnUiThread {
            startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"; putExtra(Intent.EXTRA_SUBJECT, title); putExtra(Intent.EXTRA_TEXT, text)
            }, "Compartilhar"))
        }
    }

    companion object {
        private const val ASSET_HOST = "appassets.androidplatform.net"
        private const val KEY_ALIAS = "dossie_vault_key"
    }
}
