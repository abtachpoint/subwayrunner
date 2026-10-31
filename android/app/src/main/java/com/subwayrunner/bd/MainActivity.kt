package com.subwayrunner.bd

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.google.firebase.auth.FirebaseAuth
import org.json.JSONObject
import java.io.ByteArrayInputStream

/** The game is packaged locally; its only online capability is an explicit RPC allowlist. */
class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private lateinit var authentication: PlayerAuthentication
    private lateinit var backend: BackendClient
    private lateinit var billing: DiamondBilling
    private lateinit var ads: RewardedAdsController
    private var closed = false
    private var pageReady = false
    private var deletionPending = false
    private val inflight = mutableSetOf<String>()

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val firebase = FirebaseAuth.getInstance()
        backend = BackendClient(firebase)
        authentication = PlayerAuthentication(this, firebase, ::event)
        billing = DiamondBilling(this, firebase, backend, ::event)
        ads = RewardedAdsController(this, firebase, backend, ::event)
        webView = WebView(this)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mediaPlaybackRequiresUserGesture = true
            setGeolocationEnabled(false)
            cacheMode = WebSettings.LOAD_DEFAULT
        }
        CookieManager.getInstance().setAcceptCookie(false)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)
        val assets = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                !request.isForMainFrame || request.method != "GET" || !isEntry(request.url)

            @Deprecated("Required for older WebView implementations")
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean = !isEntry(Uri.parse(url))

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                if (request.method != "GET" || !isAsset(request.url)) return denied()
                return assets.shouldInterceptRequest(request.url) ?: denied()
            }

            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                pageReady = false
                inflight.clear()
            }

            override fun onPageFinished(view: WebView, url: String) {
                if (!isEntry(Uri.parse(url))) return
                pageReady = true
                event("auth", authentication.status())
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) { request.deny() }
            override fun onGeolocationPermissionsShowPrompt(origin: String, callback: android.webkit.GeolocationPermissions.Callback) {
                callback.invoke(origin, false, false)
            }
        }
        // There is no addJavascriptInterface fallback. Older providers retain guest play.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "SubwayNative", setOf(ORIGIN)) {
                    _, message, origin, mainFrame, reply ->
                if (!mainFrame || !isTrustedOrigin(origin) || closed) return@addWebMessageListener
                val raw = try { message.data } catch (_: Exception) { null }
                    ?: return@addWebMessageListener
                if (raw.length > 32768) return@addWebMessageListener
                val request = try { JSONObject(raw) } catch (_: Exception) { return@addWebMessageListener }
                val id = request.opt("id") as? String ?: return@addWebMessageListener
                if (!id.matches(Regex("[A-Za-z0-9_-]{1,120}"))) return@addWebMessageListener
                fun replyTo(result: JSONObject?, error: ApiFailure?) {
                    if (!inflight.remove(id) || closed) return
                    val response = JSONObject().put("id", id).put("ok", error == null)
                    if (error == null) response.put("result", result ?: JSONObject())
                    else response.put("error", error.json())
                    try { reply.postMessage(response.toString()) } catch (_: Exception) { /* Page was replaced. */ }
                }
                if (id in inflight) return@addWebMessageListener
                if (inflight.size >= 24) {
                    reply.postMessage(JSONObject().put("id", id).put("ok", false)
                        .put("error", ApiFailure("BUSY", "Please wait for the current operation.").json()).toString())
                    return@addWebMessageListener
                }
                inflight.add(id)
                val method = request.opt("method") as? String
                val params = request.opt("params") as? JSONObject
                if (method == null || !method.matches(Regex("[a-z_]{1,40}")) || params == null) {
                    replyTo(null, ApiFailure("INVALID_REQUEST", "Invalid service request."))
                } else {
                    try { dispatch(method, params, ::replyTo) }
                    catch (_: Exception) { replyTo(null, ApiFailure("SERVICE_UNAVAILABLE", "This service is temporarily unavailable.", true)) }
                }
            }
        }
        val container = FrameLayout(this)
        container.setBackgroundColor(android.graphics.Color.rgb(18, 51, 70))
        container.addView(webView, FrameLayout.LayoutParams(-1, -1))
        ViewCompat.setOnApplyWindowInsetsListener(container) { view, insets ->
            val safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
            WindowInsetsCompat.CONSUMED
        }
        setContentView(container)
        ViewCompat.requestApplyInsets(container)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('subway-back'));", null)
            }
        })
        webView.loadUrl(ENTRY)
    }

    private fun dispatch(method: String, params: JSONObject, callback: ApiCallback) {
        if (deletionPending && method !in setOf("auth_status", "open_privacy", "open_deletion")) {
            callback(null, ApiFailure("DELETE_IN_PROGRESS", "Account deletion is in progress.")); return
        }
        when (method) {
            "set_age" -> {
                val group = params.optString("group", "unknown")
                if (group !in setOf("unknown", "under13", "teen", "adult")) {
                    callback(null, ApiFailure("INVALID_AGE_GROUP", "Choose an available age group.")); return
                }
                ads.setAge(group)
                callback(JSONObject().put("group", group).put("rewarded_available", group == "adult"), null)
            }
            "auth_status" -> callback(authentication.status(), null)
            "sign_in" -> authentication.signIn { result, error ->
                if (error == null) { billing.reconcile(); ads.refreshPending() }
                callback(result, error)
            }
            "sign_out" -> { authentication.signOut(); callback(authentication.status(), null) }
            "profile" -> backend.request("GET", "/v1/profile", callback = callback)
            "catalog" -> backend.request("GET", "/v1/catalog", public = true, callback = callback)
            "progress_save" -> backend.request("PUT", "/v1/progress", params, callback = callback)
            "run_start" -> backend.request("POST", "/v1/runs/start", params, callback = callback)
            "run_finish" -> backend.request("POST", "/v1/runs/finish", params, callback = callback)
            "spin" -> backend.request("POST", "/v1/spins", params, callback = callback)
            "store" -> backend.request("POST", "/v1/store", params, callback = callback)
            "products" -> { if (params.optBoolean("reconcile")) billing.reconcile(); billing.listProducts(callback) }
            "purchase" -> billing.purchase(params.optString("product_id"), callback)
            "reward" -> ads.request(params.optString("placement"), params, callback)
            "privacy_options" -> ads.privacyOptions(callback)
            "reward_refresh" -> { ads.refreshPending(); callback(JSONObject().put("status", "refreshing"), null) }
            "open_privacy" -> openExternal(BuildConfig.PRIVACY_URL, callback)
            "open_deletion" -> openExternal(BuildConfig.DELETION_URL, callback)
            "delete_account" -> deleteAccount(params, callback)
            else -> callback(null, ApiFailure("UNKNOWN_METHOD", "This service method is unavailable."))
        }
    }

    private fun deleteAccount(params: JSONObject, callback: ApiCallback) {
        val requestId = params.optString("request_id")
        if (!requestId.matches(Regex("[A-Za-z0-9_-]{8,100}"))) {
            callback(null, ApiFailure("INVALID_REQUEST_ID", "Retry account deletion from Settings.")); return
        }
        val uid = authentication.firebase.currentUser?.uid
        if (uid == null) { callback(null, ApiFailure("AUTH_REQUIRED", "Sign in before deleting your account.")); return }
        deletionPending = true
        authentication.reauthenticate { _, authError ->
            if (closed) { deletionPending = false; return@reauthenticate }
            if (authError != null) { deletionPending = false; callback(null, authError); return@reauthenticate }
            if (authentication.firebase.currentUser?.uid != uid) {
                deletionPending = false; callback(null, ApiFailure("AUTH_CHANGED", "The active player changed.")); return@reauthenticate
            }
            // Freshness is proved by the Firebase JWT auth_time, never by a JS boolean.
            backend.request("POST", "/v1/account/delete", JSONObject().put("request_id", requestId)) { result, error ->
                deletionPending = false
                if (error == null && result?.optBoolean("deleted") == true && result.optString("status") == "deleted") {
                    if (authentication.firebase.currentUser?.uid == uid) authentication.signOut()
                    callback(result, null)
                } else callback(null, error ?: ApiFailure("DELETION_UNCONFIRMED", "Deletion has not been confirmed. Your account remains signed in.", true))
            }
        }
    }

    private fun openExternal(url: String, callback: ApiCallback) {
        try {
            val uri = Uri.parse(url)
            check(uri.scheme == "https" && uri.host == "broken-mountain-7eb6.abirahomod12113.workers.dev")
            val intent = Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)
            startActivity(intent)
            callback(JSONObject().put("status", "opened"), null)
        } catch (_: ActivityNotFoundException) {
            callback(null, ApiFailure("BROWSER_UNAVAILABLE", "No browser is available to open this page."))
        } catch (_: Exception) { callback(null, ApiFailure("LINK_UNAVAILABLE", "This page could not be opened.")) }
    }

    private fun event(type: String, payload: JSONObject) {
        if (!::webView.isInitialized || closed || !pageReady) return
        runOnUiThread {
            if (!closed && pageReady) {
                val detail = JSONObject().put("type", type).put("payload", payload)
                webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('subway-native',{detail:$detail}));", null)
            }
        }
    }

    override fun onPause() {
        if (::webView.isInitialized) { event("lifecycle", JSONObject().put("paused", true)); webView.onPause() }
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) webView.onResume()
        if (::billing.isInitialized) billing.reconcile()
        if (::ads.isInitialized) ads.refreshPending()
    }

    override fun onDestroy() {
        closed = true
        inflight.clear()
        if (::ads.isInitialized) ads.close()
        if (::billing.isInitialized) billing.close()
        if (::authentication.isInitialized) authentication.close()
        if (::backend.isInitialized) backend.close()
        if (::webView.isInitialized) {
            webView.stopLoading()
            if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER))
                WebViewCompat.removeWebMessageListener(webView, "SubwayNative")
            webView.destroy()
        }
        super.onDestroy()
    }

    companion object {
        const val ORIGIN = "https://appassets.androidplatform.net"
        const val ENTRY = "$ORIGIN/assets/index.html"
        private fun isTrustedOrigin(uri: Uri): Boolean = uri.scheme == "https" &&
            uri.host == "appassets.androidplatform.net" && uri.port == -1 && uri.userInfo == null &&
            uri.path in setOf(null, "", "/") && uri.query == null && uri.fragment == null
        private fun isAsset(uri: Uri): Boolean = uri.scheme == "https" && uri.host == "appassets.androidplatform.net" &&
            uri.port == -1 && uri.userInfo == null && uri.path?.startsWith("/assets/") == true &&
            uri.query == null && uri.path?.split('/')?.none { it == "." || it == ".." } == true
        private fun isEntry(uri: Uri): Boolean = isAsset(uri) && uri.path == "/assets/index.html"
        private fun denied() = WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(ByteArray(0)))
    }
}
