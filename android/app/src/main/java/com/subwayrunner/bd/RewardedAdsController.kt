package com.subwayrunner.bd

import android.app.Activity
import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import com.google.ads.mediation.admob.AdMobAdapter
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.MobileAds
import com.google.android.gms.ads.RequestConfiguration
import com.google.android.gms.ads.rewarded.RewardedAd
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback
import com.google.android.gms.ads.rewarded.ServerSideVerificationOptions
import com.google.android.ump.ConsentInformation
import com.google.android.ump.ConsentRequestParameters
import com.google.android.ump.UserMessagingPlatform
import com.google.firebase.auth.FirebaseAuth
import org.json.JSONObject
import java.util.UUID

/** Only the authenticated service can confirm a reward. SDK callbacks never grant it. */
class RewardedAdsController(private val activity: Activity, private val auth: FirebaseAuth,
                            private val backend: BackendClient,
                            private val event: (String, JSONObject) -> Unit) {
    private data class Pending(val id: String, val uid: String, val placement: String,
                               val runId: String, val created: Long, val requestId: String)
    private val main = Handler(Looper.getMainLooper())
    private val consent = UserMessagingPlatform.getConsentInformation(activity)
    private val preferences = activity.getSharedPreferences("pending_reward_verification", Context.MODE_PRIVATE)
    private val pending = linkedMapOf<String, Pending>()
    private val polling = mutableSetOf<String>()
    private var age = "unknown"
    private var generation = 0
    private var busy = false
    private var closed = false
    private var mobileAdsInitialized = false
    private var activeReply: ApiCallback? = null
    private var activePlacement = ""
    private var activeAd: RewardedAd? = null

    init {
        for ((key, raw) in preferences.all) {
            val row = try { JSONObject(raw as? String ?: continue) } catch (_: Exception) { continue }
            if (key.startsWith("request:")) {
                if (System.currentTimeMillis() - row.optLong("created") >= 24L * 60 * 60 * 1000)
                    preferences.edit().remove(key).apply()
                continue
            }
            val item = Pending(row.optString("id"), row.optString("uid"), row.optString("placement"),
                row.optString("run_id"), row.optLong("created"), row.optString("request_id"))
            if (validId(item.id) && item.uid.isNotBlank() && item.placement in placements &&
                System.currentTimeMillis() - item.created < 24L * 60 * 60 * 1000) pending[item.id] = item
            else preferences.edit().remove(key).apply()
        }
    }

    fun setAge(group: String) {
        val next = if (group in setOf("under13", "teen", "adult")) group else "unknown"
        if (age == next) return
        age = next
        generation++
        activeAd = null
        if (busy) finish(null, ApiFailure("AGE_CHANGED", "Ad availability changed. No client reward was granted."))
    }

    fun request(placement: String, params: JSONObject, callback: ApiCallback) {
        if (closed) { callback(null, ApiFailure("ACTIVITY_CLOSED", "The game is closing.")); return }
        if (age != "adult") { callback(null, ApiFailure("ADS_ADULTS_ONLY", "Rewarded ads are available only to players aged 18 or older.")); return }
        if (placement !in placements) { callback(null, ApiFailure("INVALID_PLACEMENT", "This rewarded placement is not available.")); return }
        val uid = auth.currentUser?.uid
        if (uid == null) { callback(null, ApiFailure("AUTH_REQUIRED", "Sign in before requesting a verified reward.")); return }
        val runId = params.optString("run_id")
        if (placement == "revive" && !validId(runId)) { callback(null, ApiFailure("RUN_REQUIRED", "A current online run is required for a revive.")); return }
        if (busy) { callback(null, ApiFailure("AD_BUSY", "A rewarded action is already in progress.")); return }
        // Retrying verification never opens a second ad for the same pending action.
        val existing = pending.values.firstOrNull { it.uid == uid && it.placement == placement && (placement == "spin" || it.runId == runId) }
        if (existing != null) { poll(existing, 0, callback); return }
        busy = true
        activeReply = callback
        activePlacement = placement
        val ticket = generation
        adState("consent", true, placement)
        val consentParams = ConsentRequestParameters.Builder().setTagForUnderAgeOfConsent(false).build()
        try { consent.requestConsentInfoUpdate(activity, consentParams, {
            if (!eligible(ticket, uid)) return@requestConsentInfoUpdate
            UserMessagingPlatform.loadAndShowConsentFormIfRequired(activity) { formError ->
                if (!eligible(ticket, uid)) return@loadAndShowConsentFormIfRequired
                emitPrivacy()
                if (formError != null || !consent.canRequestAds()) {
                    finish(null, ApiFailure("CONSENT_UNAVAILABLE", "Ad consent could not be completed. You can continue without an ad.", true))
                } else initializeThen(ticket, uid) { createIntent(placement, runId, uid, ticket) }
            }
        }, {
            if (eligible(ticket, uid)) finish(null, ApiFailure("CONSENT_UNAVAILABLE", "Ad consent is unavailable. You can continue without an ad.", true))
        }) } catch (_: Exception) {
            finish(null, ApiFailure("CONSENT_UNAVAILABLE", "Ad consent is unavailable. You can continue without an ad.", true))
        }
    }

    private fun initializeThen(ticket: Int, uid: String, next: () -> Unit) {
        if (mobileAdsInitialized) { next(); return }
        try { MobileAds.setRequestConfiguration(RequestConfiguration.Builder()
            .setTagForChildDirectedTreatment(RequestConfiguration.TAG_FOR_CHILD_DIRECTED_TREATMENT_FALSE)
            .setTagForUnderAgeOfConsent(RequestConfiguration.TAG_FOR_UNDER_AGE_OF_CONSENT_FALSE)
            .setMaxAdContentRating(RequestConfiguration.MAX_AD_CONTENT_RATING_G).build())
        MobileAds.initialize(activity.applicationContext) {
            activity.runOnUiThread {
                mobileAdsInitialized = true
                if (eligible(ticket, uid)) next()
            }
        }
        } catch (_: Exception) {
            if (eligible(ticket, uid)) finish(null, ApiFailure("AD_UNAVAILABLE", "Rewarded ads are unavailable on this device.", true))
        }
    }

    private fun createIntent(placement: String, runId: String, uid: String, ticket: Int) {
        // Keep the idempotency key before sending; a timeout must not create a new intent on retry.
        val actionKey = "request:$uid:$placement:$runId"
        val saved = try { JSONObject(preferences.getString(actionKey, "") ?: "") } catch (_: Exception) { null }
        val savedRequest = saved?.takeIf {
            validId(it.optString("request_id")) && System.currentTimeMillis() - it.optLong("created") < 24L * 60 * 60 * 1000
        }
        val requestId = savedRequest?.optString("request_id") ?: UUID.randomUUID().toString()
        preferences.edit().putString(actionKey, JSONObject().put("request_id", requestId)
            .put("created", System.currentTimeMillis()).toString()).apply()
        val body = JSONObject().put("placement", placement).put("request_id", requestId)
        if (placement == "revive") body.put("run_id", runId)
        backend.request("POST", "/v1/rewards/intents", body) { response, error ->
            if (!eligible(ticket, uid)) return@request
            if (error != null) { finish(null, error); return@request }
            val id = response?.optString("intent_id").orEmpty()
            val customData = response?.optString("custom_data").orEmpty()
            if (!validId(id) || customData != id || response == null ||
                response.optString("user_id") != uid || response.optString("placement") != placement ||
                (placement == "revive" && response.optString("run_id") != runId)) {
                finish(null, ApiFailure("INVALID_REWARD_INTENT", "The reward service did not provide a valid verification request.")); return@request
            }
            val item = Pending(id, uid, placement, runId, System.currentTimeMillis(), requestId)
            pending[id] = item
            persist(item)
            // An idempotently recovered request may already have been verified. Never show again.
            if (response.optString("status") != "pending" || savedRequest != null) {
                poll(item, 0) { result, pollError -> if (eligible(ticket, uid)) finish(result, pollError) }
                return@request
            }
            loadAndShow(item, customData, ticket)
        }
    }

    private fun loadAndShow(item: Pending, customData: String, ticket: Int) {
        if (!eligible(ticket, item.uid)) return
        adState("loading", true, item.placement)
        val extras = Bundle().apply { putString("npa", "1") }
        val request = AdRequest.Builder().addNetworkExtrasBundle(AdMobAdapter::class.java, extras).build()
        val unit = if (BuildConfig.TEST_ADS || BuildConfig.DEBUG) TEST_UNIT else LIVE_UNITS.getValue(item.placement)
        try { RewardedAd.load(activity, unit, request, object : RewardedAdLoadCallback() {
            override fun onAdFailedToLoad(error: LoadAdError) {
                if (eligible(ticket, item.uid)) finish(null, ApiFailure("AD_UNAVAILABLE", "No rewarded ad is available. No reward was granted.", true))
            }
            override fun onAdLoaded(ad: RewardedAd) {
                if (!eligible(ticket, item.uid)) return
                activeAd = ad
                ad.setServerSideVerificationOptions(ServerSideVerificationOptions.Builder()
                    .setUserId(item.uid).setCustomData(customData).build())
                var earnedSignal = false
                ad.fullScreenContentCallback = object : FullScreenContentCallback() {
                    override fun onAdShowedFullScreenContent() {
                        if (eligible(ticket, item.uid)) adState("shown", true, item.placement)
                    }
                    override fun onAdFailedToShowFullScreenContent(error: AdError) {
                        activeAd = null
                        if (eligible(ticket, item.uid)) finish(null, ApiFailure("AD_UNAVAILABLE", "The rewarded ad could not be shown. No reward was granted.", true))
                    }
                    override fun onAdDismissedFullScreenContent() {
                        activeAd = null
                        if (!eligible(ticket, item.uid)) return
                        adState("closed", false, item.placement)
                        poll(item, 0) { result, error ->
                            if (!eligible(ticket, item.uid)) return@poll
                            if (error != null) finish(pendingResult(item, if (earnedSignal) "pending" else "skipped"), null)
                            else {
                                if (!earnedSignal && result?.optString("status") == "pending") result.put("status", "skipped")
                                finish(result, null)
                            }
                        }
                    }
                }
                // This signal is diagnostic only. Currency, spins and revives come from GET verification.
                try { ad.show(activity) { earnedSignal = true } } catch (_: Exception) {
                    activeAd = null
                    if (eligible(ticket, item.uid)) finish(null, ApiFailure("AD_UNAVAILABLE", "The rewarded ad could not be shown. No reward was granted.", true))
                }
            }
        }) } catch (_: Exception) {
            if (eligible(ticket, item.uid)) finish(null, ApiFailure("AD_UNAVAILABLE", "Rewarded ads are unavailable on this device.", true))
        }
    }

    private fun eligible(ticket: Int, uid: String): Boolean {
        if (closed || ticket != generation || age != "adult") return false
        if (auth.currentUser?.uid != uid) {
            finish(null, ApiFailure("AUTH_CHANGED", "The active player changed. Refresh to verify the original reward."))
            return false
        }
        if (activity.isFinishing || activity.isDestroyed) {
            finish(null, ApiFailure("ACTIVITY_CLOSED", "The game is closing. Pending rewards can be checked after reopening."))
            return false
        }
        return true
    }

    private fun poll(item: Pending, attempt: Int, callback: ApiCallback? = null) {
        if (closed || auth.currentUser?.uid != item.uid) {
            callback?.invoke(null, ApiFailure("AUTH_CHANGED", "Sign in to the original account to verify this reward.")); return
        }
        if (!polling.add(item.id)) {
            callback?.invoke(pendingResult(item), null); return
        }
        backend.request("GET", "/v1/rewards/intents/${item.id}") { result, error ->
            polling.remove(item.id)
            if (closed) return@request
            if (auth.currentUser?.uid != item.uid) {
                callback?.invoke(null, ApiFailure("AUTH_CHANGED", "Sign in to the original account to verify this reward."))
                return@request
            }
            if (error != null) {
                callback?.invoke(pendingResult(item), null)
                return@request
            }
            val status = result?.optString("status", "pending") ?: "pending"
            if (result == null || status !in setOf("pending", "granted", "expired", "rejected", "failed") ||
                result.optString("intent_id") != item.id || result.optString("placement") != item.placement ||
                (item.placement == "revive" && result.optString("run_id") != item.runId)) {
                callback?.invoke(pendingResult(item), null)
                return@request
            }
            val value = result
            value.put("intent_id", item.id).put("placement", item.placement)
            if (item.runId.isNotBlank()) value.put("run_id", item.runId)
            if (status == "granted") {
                forget(item)
                event("reward", value)
                event("profile_refresh", JSONObject())
                callback?.invoke(value, null)
            } else if (status in setOf("expired", "rejected", "failed")) {
                forget(item)
                callback?.invoke(value, null)
            } else if (callback != null && attempt < POLL_DELAYS.size) {
                main.postDelayed({ poll(item, attempt + 1, callback) }, POLL_DELAYS[attempt])
            } else callback?.invoke(value, null)
        }
    }

    /** Called after explicit refresh/resume; this requests no ad inventory or consent. */
    fun refreshPending() {
        // A foreground lifecycle callback can race full-screen dismissal. Wait for its callback.
        if (closed || busy) return
        val uid = auth.currentUser?.uid ?: return
        pending.values.filter { it.uid == uid }.toList().forEach { poll(it, 0) }
    }

    fun privacyOptions(callback: ApiCallback) {
        if (age != "adult") { callback(JSONObject().put("required", false), null); return }
        if (consent.privacyOptionsRequirementStatus != ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED) {
            callback(JSONObject().put("required", false), null); return
        }
        adState("privacy", true, "")
        try { UserMessagingPlatform.showPrivacyOptionsForm(activity) { error ->
            adState("closed", false, "")
            emitPrivacy()
            if (error == null) callback(JSONObject().put("required", true).put("can_request_ads", consent.canRequestAds()), null)
            else callback(null, ApiFailure("PRIVACY_UNAVAILABLE", "Ad privacy choices could not be opened. Please try again.", true))
        } } catch (_: Exception) {
            adState("closed", false, "")
            callback(null, ApiFailure("PRIVACY_UNAVAILABLE", "Ad privacy choices could not be opened. Please try again.", true))
        }
    }

    private fun emitPrivacy() = event("privacy", JSONObject().put("required",
        consent.privacyOptionsRequirementStatus == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED))
    private fun adState(status: String, paused: Boolean, placement: String) = event("ad_state",
        JSONObject().put("status", status).put("paused", paused).put("placement", placement))
    private fun pendingResult(item: Pending, status: String = "pending") = JSONObject()
        .put("status", status).put("intent_id", item.id).put("placement", item.placement)
        .apply { if (item.runId.isNotBlank()) put("run_id", item.runId) }
    private fun persist(item: Pending) {
        preferences.edit().putString(item.id, JSONObject().put("id", item.id).put("uid", item.uid)
            .put("placement", item.placement).put("run_id", item.runId).put("created", item.created)
            .put("request_id", item.requestId).toString()).apply()
    }
    private fun forget(item: Pending) {
        pending.remove(item.id)
        preferences.edit().remove(item.id).remove("request:${item.uid}:${item.placement}:${item.runId}").apply()
    }
    private fun finish(result: JSONObject?, error: ApiFailure?) {
        val callback = activeReply
        activeReply = null
        busy = false
        adState("closed", false, activePlacement)
        activePlacement = ""
        callback?.invoke(result, error)
    }
    fun close() {
        closed = true
        generation++
        activeAd = null
        main.removeCallbacksAndMessages(null)
        activeReply = null
        busy = false
    }
    companion object {
        private val placements = setOf("revive", "spin")
        private const val TEST_UNIT = "ca-app-pub-3940256099942544/5224354917"
        private val LIVE_UNITS = mapOf("revive" to "ca-app-pub-1379059201302335/6015873225",
            "spin" to "ca-app-pub-1379059201302335/7963379715")
        private val POLL_DELAYS = longArrayOf(1000, 2000, 4000, 6000)
        private fun validId(id: String) = id.matches(Regex("[A-Za-z0-9_-]{8,160}"))
    }
}
