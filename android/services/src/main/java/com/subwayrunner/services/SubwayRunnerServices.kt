package com.subwayrunner.services

import android.app.Activity
import android.os.Bundle
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import com.google.ads.mediation.admob.AdMobAdapter
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.MobileAds
import com.google.android.gms.ads.RequestConfiguration
import com.google.android.gms.ads.interstitial.InterstitialAd
import com.google.android.gms.ads.interstitial.InterstitialAdLoadCallback
import com.google.android.gms.ads.rewarded.RewardedAd
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback
import com.google.android.ump.ConsentInformation
import com.google.android.ump.ConsentRequestParameters
import com.google.android.ump.UserMessagingPlatform
import org.godotengine.godot.Godot
import org.godotengine.godot.plugin.GodotPlugin
import org.godotengine.godot.plugin.SignalInfo
import org.godotengine.godot.plugin.UsedByGodot
import org.json.JSONArray
import org.json.JSONObject

/**
 * The Android layer never grants a store item and never acknowledges a purchase.
 * PURCHASED tokens go to the HTTPS backend; pending purchases remain pending.
 * No MobileAds/UMP call is made before an adult age selection. Ad callbacks are
 * invalidated by an epoch when configuration, age or lifecycle changes.
 */
class SubwayRunnerServices(godot: Godot) : GodotPlugin(godot) {
    private val productIds = linkedSetOf(
        "coin_pack_small", "coin_pack_medium", "coin_pack_large", "starter_pack",
        "character_astronaut", "character_neon", "remove_forced_ads"
    )
    private val details = mutableMapOf<String, ProductDetails>()
    private var config = JSONObject()
    private var ageGroup = "unknown"
    private var configured = false
    private var billingEnabled = false
    private var destroyed = false
    private var billing: BillingClient? = null
    private var billingConnecting = false
    private var adsEpoch = 0
    private var consent: ConsentInformation? = null
    private var adsInitialized = false
    private var adsInitializing = false
    private var rewardLoading = false
    private var interstitialLoading = false
    private var reward: RewardedAd? = null
    private var interstitial: InterstitialAd? = null
    private var adShowing = false

    override fun getPluginName() = "SubwayRunnerServices"

    override fun getPluginSignals(): Set<SignalInfo> =
        setOf(SignalInfo("event_json", String::class.java))

    private fun emit(type: String, data: JSONObject = JSONObject()) {
        if (destroyed) return
        data.put("type", type)
        // No token, error body, birth date or account identifier is logged.
        emitSignal("event_json", data.toString())
    }

    private fun error(operation: String, code: String) = emit(
        "error", JSONObject().put("operation", operation).put("code", code)
    )

    private fun onUi(operation: String, block: (Activity) -> Unit) {
        val current = activity
        if (current == null || destroyed) {
            error(operation, "ACTIVITY_UNAVAILABLE")
            return
        }
        current.runOnUiThread {
            if (!destroyed && !current.isFinishing && !current.isDestroyed) block(current)
        }
    }

    @UsedByGodot
    fun configure(config_json: String) = onUi("configure") { current ->
        val parsed = try { JSONObject(config_json) } catch (_: Exception) {
            error("configure", "INVALID_CONFIG")
            return@onUi
        }
        if (parsed.optString("package", current.packageName) != current.packageName) {
            error("configure", "PACKAGE_MISMATCH")
            return@onUi
        }
        stopAds()
        config = parsed
        configured = true
        billingEnabled = parsed.optBoolean("billing_enabled", false) &&
            parsed.optString("backend_url").startsWith("https://")
        if (!billingEnabled) {
            billing?.endConnection()
            billing = null
            billingConnecting = false
        }
        details.clear()
        emit("configured", JSONObject().put("billing_available", billingEnabled).put("ads_adults_only", true)
            .put("test_mode", BuildConfig.DEBUG && parsed.optBoolean("test_mode", false)))
        if (billingEnabled) connectBilling(current) else emit("products", JSONObject().put("products", JSONArray()))
        if (ageGroup == "adult") prepareAdultAds(current)
    }

    @UsedByGodot
    fun set_age_group(group: String) = onUi("set_age_group") { current ->
        val next = if (group in setOf("under13", "teen", "adult")) group else "unknown"
        if (ageGroup != next) {
            stopAds()
            ageGroup = next
        }
        emit("age", JSONObject().put("group", ageGroup).put("ads_allowed", ageGroup == "adult"))
        if (configured && ageGroup == "adult") prepareAdultAds(current)
    }

    private fun connectBilling(current: Activity) {
        if (!configured || !billingEnabled) return
        if (billing?.isReady == true) {
            queryProducts()
            queryPurchases()
            return
        }
        if (billingConnecting || !configured || !billingEnabled) return
        if (billing == null) {
            billing = BillingClient.newBuilder(current.applicationContext)
                .setListener { result, purchases ->
                    onUi("billing_update") {
                        when (result.responseCode) {
                            BillingClient.BillingResponseCode.OK -> purchases.orEmpty().forEach(::emitPurchase)
                            BillingClient.BillingResponseCode.USER_CANCELED -> emit("purchase_cancelled")
                            BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> queryPurchases()
                            else -> error("purchase", "PLAY_${result.responseCode}")
                        }
                    }
                }
                .enablePendingPurchases(
                    PendingPurchasesParams.newBuilder().enableOneTimeProducts().build()
                )
                .enableAutoServiceReconnection()
                .build()
        }
        billingConnecting = true
        billing?.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                onUi("billing_connect") {
                    billingConnecting = false
                    if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                        emit("billing_ready")
                        queryProducts()
                        queryPurchases()
                    } else error("billing_connect", "PLAY_${result.responseCode}")
                }
            }

            override fun onBillingServiceDisconnected() {
                onUi("billing_disconnected") {
                    billingConnecting = false
                    details.clear()
                    emit("billing_disconnected")
                }
            }
        })
    }

    @UsedByGodot
    fun fetch_products() = onUi("fetch_products") { current ->
        if (!billingEnabled) emit("products", JSONObject().put("products", JSONArray()))
        else if (billing?.isReady == true) queryProducts() else connectBilling(current)
    }

    private fun queryProducts() {
        val client = billing ?: return
        if (!client.isReady) return
        val params = QueryProductDetailsParams.newBuilder().setProductList(
            productIds.map {
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(it).setProductType(BillingClient.ProductType.INAPP).build()
            }
        ).build()
        client.queryProductDetailsAsync(params) { result, response ->
            onUi("fetch_products") {
                if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                    details.clear()
                    error("fetch_products", "PLAY_${result.responseCode}")
                    return@onUi
                }
                details.clear()
                val rows = JSONArray()
                for (product in response.productDetailsList) {
                    if (product.productId !in productIds) continue
                    val offer = product.oneTimePurchaseOfferDetailsList?.firstOrNull()
                        ?: product.oneTimePurchaseOfferDetails ?: continue
                    details[product.productId] = product
                    rows.put(JSONObject()
                        .put("product_id", product.productId)
                        .put("title", product.name)
                        .put("price", offer.formattedPrice)
                        .put("currency", offer.priceCurrencyCode)
                        .put("price_micros", offer.priceAmountMicros))
                }
                emit("products", JSONObject().put("products", rows))
            }
        }
    }

    @UsedByGodot
    fun request_purchase(product_id: String) = onUi("purchase") { current ->
        if (!configured || !billingEnabled) {
            error("purchase", "BACKEND_NOT_CONFIGURED")
            return@onUi
        }
        if (product_id !in productIds) {
            error("purchase", "UNKNOWN_PRODUCT")
            return@onUi
        }
        val client = billing
        if (client?.isReady != true) {
            error("purchase", "BILLING_NOT_READY")
            connectBilling(current)
            return@onUi
        }
        val product = details[product_id]
        if (product == null) {
            error("purchase", "PRODUCT_NOT_AVAILABLE")
            queryProducts()
            return@onUi
        }
        val detailParams = BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(product)
        product.oneTimePurchaseOfferDetailsList?.firstOrNull()?.let {
            detailParams.setOfferToken(it.offerToken)
        }
        val flow = BillingFlowParams.newBuilder().setProductDetailsParamsList(listOf(detailParams.build()))
        config.optString("obfuscated_account_id").takeIf {
            it.matches(Regex("[a-f0-9]{64}"))
        }?.let { flow.setObfuscatedAccountId(it) }
        val result = client.launchBillingFlow(current, flow.build())
        if (result.responseCode != BillingClient.BillingResponseCode.OK) {
            error("purchase", "PLAY_${result.responseCode}")
            if (result.responseCode == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) queryPurchases()
        }
        // ProductDetails are short-lived. Fetch fresh data for the next purchase.
        details.remove(product_id)
    }

    @UsedByGodot
    fun restore_purchases() = onUi("restore_purchases") { current ->
        if (!billingEnabled) emit("restore_complete", JSONObject().put("count", 0).put("available", false))
        else if (billing?.isReady == true) queryPurchases() else connectBilling(current)
    }

    private fun queryPurchases() {
        val client = billing ?: return
        if (!client.isReady) return
        client.queryPurchasesAsync(
            QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build()
        ) { result, purchases ->
            onUi("restore_purchases") {
                if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                    purchases.forEach(::emitPurchase)
                    emit("restore_complete", JSONObject().put("count", purchases.size))
                } else error("restore_purchases", "PLAY_${result.responseCode}")
            }
        }
    }

    private fun emitPurchase(purchase: Purchase) {
        val state = when (purchase.purchaseState) {
            Purchase.PurchaseState.PURCHASED -> "PURCHASED"
            Purchase.PurchaseState.PENDING -> "PENDING"
            else -> "UNSPECIFIED"
        }
        for (id in purchase.products) {
            if (id !in productIds) continue
            emit("purchase", JSONObject()
                .put("product_id", id).put("purchase_token", purchase.purchaseToken)
                .put("state", state).put("quantity", purchase.quantity)
                .put("acknowledged", purchase.isAcknowledged))
        }
        // Backend verifies Google's response, grants exactly once and acknowledges/consumes.
    }

    private fun stopAds() {
        adsEpoch += 1
        reward = null
        interstitial = null
        rewardLoading = false
        interstitialLoading = false
        adsInitializing = false
        adShowing = false
    }

    private fun validAdUnit(id: String): Boolean {
        if (!id.matches(Regex("ca-app-pub-[0-9]{16}/[0-9]{10}"))) return false
        if (!id.contains("3940256099942544")) return true
        return BuildConfig.DEBUG && config.optBoolean("test_mode", false) && id in setOf(
            "ca-app-pub-3940256099942544/5224354917",
            "ca-app-pub-3940256099942544/1033173712"
        )
    }

    private fun prepareAdultAds(current: Activity) {
        if (!configured || ageGroup != "adult" || adsInitializing || adShowing) return
        if (!validAdUnit(config.optString("reward_ad_unit")) ||
            !validAdUnit(config.optString("interstitial_ad_unit"))) {
            error("ads", "AD_UNITS_NOT_CONFIGURED")
            return
        }
        val epoch = adsEpoch
        adsInitializing = true
        consent = UserMessagingPlatform.getConsentInformation(current)
        val params = ConsentRequestParameters.Builder().setTagForUnderAgeOfConsent(false).build()
        consent?.requestConsentInfoUpdate(current, params, {
            if (!adultEpoch(epoch)) return@requestConsentInfoUpdate
            UserMessagingPlatform.loadAndShowConsentFormIfRequired(current) { formError ->
                if (!adultEpoch(epoch)) return@loadAndShowConsentFormIfRequired
                adsInitializing = false
                emitPrivacyState()
                if (formError != null) error("consent", "UMP_${formError.errorCode}")
                if (consent?.canRequestAds() == true) initializeAds(current, epoch)
            }
        }, { consentError ->
            if (adultEpoch(epoch)) {
                adsInitializing = false
                error("consent", "UMP_${consentError.errorCode}")
                // Fail closed on an unsuccessful refresh; no stale consent shortcut.
            }
        })
    }

    private fun adultEpoch(epoch: Int) = !destroyed && epoch == adsEpoch && ageGroup == "adult"

    private fun initializeAds(current: Activity, epoch: Int) {
        if (!adultEpoch(epoch) || consent?.canRequestAds() != true) return
        val requestConfig = RequestConfiguration.Builder()
            .setMaxAdContentRating(RequestConfiguration.MAX_AD_CONTENT_RATING_G)
        if (BuildConfig.DEBUG) {
            val testDevices = config.optJSONArray("test_device_ids")
            val ids = (0 until (testDevices?.length() ?: 0)).map { testDevices!!.getString(it) }
            val officialSampleUnits = config.optBoolean("test_mode", false) &&
                config.optString("reward_ad_unit") == "ca-app-pub-3940256099942544/5224354917" &&
                config.optString("interstitial_ad_unit") == "ca-app-pub-3940256099942544/1033173712"
            if (ids.isEmpty() && !officialSampleUnits) {
                error("ads", "DEBUG_TEST_DEVICE_REQUIRED")
                return
            }
            requestConfig.setTestDeviceIds(ids)
        }
        MobileAds.setRequestConfiguration(requestConfig.build())
        if (adsInitialized) {
            loadAds(current, epoch)
            return
        }
        adsInitializing = true
        MobileAds.initialize(current.applicationContext) {
            current.runOnUiThread {
                if (adultEpoch(epoch)) {
                    adsInitialized = true
                    adsInitializing = false
                    emit("ads_ready")
                    loadAds(current, epoch)
                }
            }
        }
    }

    private fun loadAds(current: Activity, epoch: Int) {
        if (!adultEpoch(epoch) || !adsInitialized || consent?.canRequestAds() != true) return
        if (reward == null && !rewardLoading) {
            rewardLoading = true
            RewardedAd.load(current, config.getString("reward_ad_unit"), contextualAdRequest(),
                object : RewardedAdLoadCallback() {
                    override fun onAdLoaded(ad: RewardedAd) {
                        if (!adultEpoch(epoch)) return
                        rewardLoading = false
                        reward = ad
                        emit("reward_available", JSONObject().put("available", true))
                    }
                    override fun onAdFailedToLoad(adError: LoadAdError) {
                        if (!adultEpoch(epoch)) return
                        rewardLoading = false
                        error("reward_load", "ADS_${adError.code}")
                    }
                })
        }
        if (interstitial == null && !interstitialLoading) {
            interstitialLoading = true
            InterstitialAd.load(current, config.getString("interstitial_ad_unit"), contextualAdRequest(),
                object : InterstitialAdLoadCallback() {
                    override fun onAdLoaded(ad: InterstitialAd) {
                        if (!adultEpoch(epoch)) return
                        interstitialLoading = false
                        interstitial = ad
                    }
                    override fun onAdFailedToLoad(adError: LoadAdError) {
                        if (!adultEpoch(epoch)) return
                        interstitialLoading = false
                        error("interstitial_load", "ADS_${adError.code}")
                    }
                })
        }
    }

    private fun contextualAdRequest(): AdRequest {
        val extras = Bundle().apply { putString("npa", "1") }
        return AdRequest.Builder().addNetworkExtrasBundle(AdMobAdapter::class.java, extras).build()
    }

    @UsedByGodot
    fun request_reward(placement: String) = onUi("reward") { current ->
        if (placement !in setOf("revive", "double_coins")) {
            error("reward", "UNKNOWN_PLACEMENT")
            return@onUi
        }
        val epoch = adsEpoch
        val ad = reward
        if (!adultEpoch(epoch) || consent?.canRequestAds() != true || ad == null || adShowing) {
            error("reward", "AD_NOT_AVAILABLE")
            if (ageGroup == "adult" && adsInitialized) loadAds(current, epoch)
            return@onUi
        }
        reward = null
        adShowing = true
        var earned = false
        ad.fullScreenContentCallback = object : FullScreenContentCallback() {
            override fun onAdDismissedFullScreenContent() {
                if (!adultEpoch(epoch)) return
                adShowing = false
                emit("ad_closed", JSONObject().put("format", "rewarded").put("earned", earned))
                loadAds(current, epoch)
            }
            override fun onAdFailedToShowFullScreenContent(adError: AdError) {
                if (!adultEpoch(epoch)) return
                adShowing = false
                error("reward", "ADS_${adError.code}")
                emit("ad_closed", JSONObject().put("format", "rewarded").put("earned", false))
                loadAds(current, epoch)
            }
        }
        emit("ad_opened", JSONObject().put("format", "rewarded"))
        ad.show(current) {
            if (adultEpoch(epoch) && !earned) {
                earned = true
                // Only SDK earned callback grants a gameplay reward, never dismissal.
                emit("reward", JSONObject().put("placement", placement))
            }
        }
    }

    @UsedByGodot
    fun show_interstitial() = onUi("interstitial") { current ->
        val epoch = adsEpoch
        val ad = interstitial
        if (!adultEpoch(epoch) || consent?.canRequestAds() != true || ad == null || adShowing) {
            error("interstitial", "AD_NOT_AVAILABLE")
            return@onUi
        }
        interstitial = null
        adShowing = true
        ad.fullScreenContentCallback = object : FullScreenContentCallback() {
            override fun onAdDismissedFullScreenContent() {
                if (!adultEpoch(epoch)) return
                adShowing = false
                emit("ad_closed", JSONObject().put("format", "interstitial"))
                loadAds(current, epoch)
            }
            override fun onAdFailedToShowFullScreenContent(adError: AdError) {
                if (!adultEpoch(epoch)) return
                adShowing = false
                error("interstitial", "ADS_${adError.code}")
                emit("ad_closed", JSONObject().put("format", "interstitial"))
                loadAds(current, epoch)
            }
        }
        emit("ad_opened", JSONObject().put("format", "interstitial"))
        ad.show(current)
    }

    private fun emitPrivacyState() {
        emit("privacy", JSONObject().put("required",
            consent?.privacyOptionsRequirementStatus ==
                ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED))
    }

    @UsedByGodot
    fun show_privacy_options() = onUi("privacy") { current ->
        if (ageGroup != "adult" || consent == null) {
            error("privacy", "PRIVACY_OPTIONS_UNAVAILABLE")
            return@onUi
        }
        stopAds()
        val epoch = adsEpoch
        UserMessagingPlatform.showPrivacyOptionsForm(current) { formError ->
            if (!adultEpoch(epoch)) return@showPrivacyOptionsForm
            if (formError != null) error("privacy", "UMP_${formError.errorCode}")
            emitPrivacyState()
            if (consent?.canRequestAds() == true) initializeAds(current, epoch)
        }
    }

    override fun onMainResume() {
        super.onMainResume()
        if (configured) onUi("resume") { connectBilling(it) }
    }

    override fun onMainDestroy() {
        stopAds()
        destroyed = true
        billing?.endConnection()
        billing = null
        details.clear()
        super.onMainDestroy()
    }
}
