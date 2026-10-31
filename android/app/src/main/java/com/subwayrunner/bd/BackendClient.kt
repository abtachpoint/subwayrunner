package com.subwayrunner.bd

import android.os.Handler
import android.os.Looper
import com.google.firebase.auth.FirebaseAuth
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors

data class ApiFailure(val code: String, val message: String, val retryable: Boolean = false) {
    fun json() = JSONObject().put("code", code).put("message", message).put("retryable", retryable)
}
typealias ApiCallback = (JSONObject?, ApiFailure?) -> Unit

/** Firebase identity tokens exist only in native memory and TLS request headers. */
class BackendClient(private val auth: FirebaseAuth) {
    private val executor = Executors.newFixedThreadPool(3)
    private val main = Handler(Looper.getMainLooper())
    private val base = BuildConfig.BACKEND_URL.trimEnd('/')

    fun request(method: String, path: String, body: JSONObject? = null, public: Boolean = false,
                callback: ApiCallback) {
        if (executor.isShutdown) return
        if (!path.startsWith("/v1/") || path.contains("..") || path.contains('?') || path.contains('#')) {
            callback(null, ApiFailure("INVALID_PATH", "Invalid service request.")); return
        }
        if (public) { execute(method, path, body, null, null, false, callback); return }
        val user = auth.currentUser
        if (user == null) { callback(null, ApiFailure("AUTH_REQUIRED", "Sign in with Play Games to sync or use the online store.")); return }
        user.getIdToken(false).addOnSuccessListener { result ->
            val token = result.token
            if (token.isNullOrBlank()) callback(null, ApiFailure("AUTH_REQUIRED", "Please sign in again."))
            else execute(method, path, body, token, user.uid, false, callback)
        }.addOnFailureListener { callback(null, ApiFailure("AUTH_UNAVAILABLE", "Sign-in could not be refreshed. Offline gameplay remains available.", true)) }
    }

    private fun execute(method: String, path: String, body: JSONObject?, token: String?, uid: String?,
                        refreshed: Boolean, callback: ApiCallback) {
        if (executor.isShutdown) return
        executor.execute {
            var connection: HttpURLConnection? = null
            try {
                val url = URL(base + path)
                check(url.protocol == "https" && url.host == "subway-runner-api.abirahomod12113.workers.dev")
                connection = url.openConnection() as HttpURLConnection
                connection.instanceFollowRedirects = false
                connection.requestMethod = method
                connection.connectTimeout = 15000
                connection.readTimeout = 20000
                connection.setRequestProperty("Accept", "application/json")
                connection.setRequestProperty("Cache-Control", "no-store")
                if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
                if (body != null) {
                    val bytes = body.toString().toByteArray(Charsets.UTF_8)
                    require(bytes.size <= 32768)
                    connection.doOutput = true
                    connection.setRequestProperty("Content-Type", "application/json")
                    connection.setFixedLengthStreamingMode(bytes.size)
                    connection.outputStream.use { it.write(bytes) }
                }
                val status = connection.responseCode
                val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                val data = stream?.use { input ->
                    val output = ByteArrayOutputStream()
                    val buffer = ByteArray(4096)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        require(output.size() + count <= 131072)
                        output.write(buffer, 0, count)
                    }
                    output.toString("UTF-8")
                }.orEmpty()
                val json = try { JSONObject(data) } catch (_: Exception) { JSONObject() }
                main.post {
                    if (uid != null && auth.currentUser?.uid != uid) {
                        callback(null, ApiFailure("AUTH_CHANGED", "The active player changed. Please retry."))
                    } else if (status == 401 && token != null && !refreshed) {
                        val user = auth.currentUser
                        if (user == null) callback(null, ApiFailure("AUTH_REQUIRED", "Please sign in again."))
                        else user.getIdToken(true).addOnSuccessListener { result ->
                            if (result.token.isNullOrEmpty()) callback(null, ApiFailure("AUTH_REQUIRED", "Please sign in again."))
                            else execute(method, path, body, result.token, uid, true, callback)
                        }.addOnFailureListener { callback(null, ApiFailure("AUTH_REQUIRED", "Please sign in again.")) }
                    } else if (status in 200..299) {
                        callback(json, null)
                    } else {
                        val nested = json.optJSONObject("error")
                        val code = nested?.optString("code")?.takeIf { it.isNotBlank() }
                            ?: json.optString("error", "HTTP_$status")
                        val safeCode = if (code.matches(Regex("[A-Za-z0-9_]{1,80}"))) code else "SERVICE_ERROR"
                        val message = when (status) {
                            401 -> "Please sign in again."
                            403 -> "This action is not available for the current player."
                            409 -> "This action cannot be completed. Refresh your balance and try again."
                            429 -> "Please wait before trying again."
                            else -> if (status >= 500) "The online service is temporarily unavailable." else "The online action could not be completed."
                        }
                        callback(null, ApiFailure(safeCode, message, status >= 500 || status == 429))
                    }
                }
            } catch (_: Exception) {
                main.post { callback(null, ApiFailure("NETWORK_UNAVAILABLE", "Could not connect securely. Offline gameplay is available.", true)) }
            } finally { connection?.disconnect() }
        }
    }

    fun close() { executor.shutdownNow() }
}
