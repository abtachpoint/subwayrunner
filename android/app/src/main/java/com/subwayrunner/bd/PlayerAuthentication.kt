package com.subwayrunner.bd

import android.app.Activity
import com.google.android.gms.games.PlayGames
import com.google.android.gms.games.PlayGamesSdk
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.PlayGamesAuthProvider
import org.json.JSONObject
import java.security.MessageDigest

class PlayerAuthentication(private val activity: Activity, val firebase: FirebaseAuth,
                           private val event: (String, JSONObject) -> Unit) {
    private var signingIn = false
    private val listener = FirebaseAuth.AuthStateListener { event("auth", status()) }
    private val configured: Boolean = activity.getString(R.string.play_games_app_id)
        .matches(Regex("[0-9]+"))

    init {
        if (configured) PlayGamesSdk.initialize(activity.applicationContext)
        firebase.addAuthStateListener(listener)
    }

    fun status(): JSONObject {
        val user = firebase.currentUser
        return JSONObject().put("signed_in", user != null)
            .put("uid", user?.uid ?: JSONObject.NULL)
            .put("display_name", user?.displayName ?: "Player")
            .put("play_games_configured", configured)
            .put("accountBinding", user?.uid?.let(::accountBinding) ?: JSONObject.NULL)
    }

    fun signIn(callback: ApiCallback) {
        authorize(false, callback)
    }

    /** Exchanges a newly requested Games code and refreshes Firebase auth_time. */
    fun reauthenticate(callback: ApiCallback) {
        if (firebase.currentUser == null) {
            callback(null, ApiFailure("AUTH_REQUIRED", "Sign in before deleting your account.")); return
        }
        authorize(true, callback)
    }

    private fun authorize(reauthenticate: Boolean, callback: ApiCallback) {
        if (!configured) {
            callback(null, ApiFailure("PLAY_GAMES_ID_MISSING", "Play Games app_id resource is not configured. Guest play remains available.")); return
        }
        if (signingIn) { callback(null, ApiFailure("SIGN_IN_BUSY", "Sign-in is already in progress.")); return }
        val previousUser = firebase.currentUser
        signingIn = true
        try {
            val client = PlayGames.getGamesSignInClient(activity)
            client.signIn().addOnCompleteListener { signIn ->
                if (!signIn.isSuccessful || signIn.result?.isAuthenticated != true) {
                    signingIn = false
                    callback(null, ApiFailure("PLAY_GAMES_SIGN_IN_FAILED", "Play Games sign-in did not complete. You can continue as a guest."))
                } else {
                    client.requestServerSideAccess(BuildConfig.SERVER_CLIENT_ID, reauthenticate)
                        .addOnSuccessListener { code ->
                            if (code.isNullOrBlank()) {
                                signingIn = false
                                callback(null, ApiFailure("AUTHORIZATION_FAILED", "Play Games authorization was unavailable."))
                            } else {
                                // Firebase exchanges the one-time Games authorization code. No
                                // client secret, refresh token or identity token is exposed to JS.
                                val credential = PlayGamesAuthProvider.getCredential(code)
                                if (reauthenticate && (previousUser == null || firebase.currentUser?.uid != previousUser.uid)) {
                                    signingIn = false
                                    callback(null, ApiFailure("AUTH_CHANGED", "The active player changed. Retry from Settings."))
                                    return@addOnSuccessListener
                                }
                                val exchange = if (reauthenticate) previousUser!!.reauthenticate(credential)
                                    else firebase.signInWithCredential(credential)
                                exchange
                                    .addOnSuccessListener {
                                        if (reauthenticate) {
                                            // The token stays native. Backend checks its actual auth_time.
                                            firebase.currentUser?.getIdToken(true)
                                                ?.addOnSuccessListener { token ->
                                                    signingIn = false
                                                    if (token.token.isNullOrBlank()) callback(null, ApiFailure("AUTH_REQUIRED", "Please sign in again."))
                                                    else callback(status(), null)
                                                }?.addOnFailureListener {
                                                    signingIn = false
                                                    callback(null, ApiFailure("REAUTH_FAILED", "Account authorization could not be refreshed."))
                                                } ?: run {
                                                    signingIn = false
                                                    callback(null, ApiFailure("AUTH_REQUIRED", "Please sign in again."))
                                                }
                                        } else {
                                            signingIn = false
                                            callback(status(), null)
                                        }
                                    }.addOnFailureListener {
                                        signingIn = false
                                        callback(null, ApiFailure("FIREBASE_SIGN_IN_FAILED", "Account sign-in could not be completed. Please try again."))
                                    }
                            }
                        }.addOnFailureListener {
                            signingIn = false
                            callback(null, ApiFailure("AUTHORIZATION_FAILED", "Play Games authorization failed. Please retry."))
                        }
                }
            }
        } catch (_: Exception) {
            signingIn = false
            callback(null, ApiFailure("PLAY_GAMES_UNAVAILABLE", "Play Games is unavailable on this device. Guest play remains available."))
        }
    }

    fun signOut() { firebase.signOut() }
    fun close() { firebase.removeAuthStateListener(listener) }

    companion object {
        fun accountBinding(uid: String): String = MessageDigest.getInstance("SHA-256")
            .digest(uid.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it.toInt() and 255) }
    }
}
