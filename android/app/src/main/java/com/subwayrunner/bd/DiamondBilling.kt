package com.subwayrunner.bd

import android.app.Activity
import android.content.Context
import android.os.Handler
import android.os.Looper
import com.android.billingclient.api.*
import com.google.firebase.auth.FirebaseAuth
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

/** Purchases are never granted or consumed by a client callback. */
class DiamondBilling(private val activity: Activity, private val auth: FirebaseAuth,
                     private val backend: BackendClient,
                     private val event: (String, JSONObject) -> Unit) {
    private val ids = setOf("diamonds_100", "diamonds_500", "diamonds_1200", "diamonds_2500")
    private val products = mutableMapOf<String, ProductDetails>()
    private val main = Handler(Looper.getMainLooper())
    private val preferences = activity.getSharedPreferences("pending_play_purchases", Context.MODE_PRIVATE)
    private val processing = mutableSetOf<String>()
    private val waiting = mutableListOf<(Boolean) -> Unit>()
    private var connecting = false
    private var closed = false
    private var reconnects = 0
    private val client: BillingClient = BillingClient.newBuilder(activity.applicationContext)
        .setListener { result, purchases ->
            activity.runOnUiThread {
                when (result.responseCode) {
                    BillingClient.BillingResponseCode.OK -> purchases.orEmpty().forEach(::handlePurchase)
                    BillingClient.BillingResponseCode.USER_CANCELED -> event("purchase", JSONObject().put("status", "cancelled"))
                    BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> reconcile()
                    else -> event("purchase", JSONObject().put("status", "failed").put("code", "PLAY_${result.responseCode}"))
                }
            }
        }
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .enableAutoServiceReconnection()
        .build()

    private fun connect(done: (Boolean) -> Unit) {
        if (closed) { done(false); return }
        if (client.isReady) { done(true); return }
        waiting.add(done)
        if (connecting) return
        connecting = true
        client.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                activity.runOnUiThread {
                    connecting = false
                    val success = result.responseCode == BillingClient.BillingResponseCode.OK
                    if (success) reconnects = 0
                    val callbacks = waiting.toList(); waiting.clear()
                    callbacks.forEach { it(success) }
                }
            }
            override fun onBillingServiceDisconnected() {
                activity.runOnUiThread {
                    connecting = false
                    products.clear()
                    if (!closed && reconnects++ < 4) main.postDelayed({ reconcile() }, (1000L shl reconnects.coerceAtMost(4)))
                }
            }
        })
    }

    fun listProducts(callback: ApiCallback) {
        connect { ready ->
            if (!ready) { callback(null, ApiFailure("BILLING_UNAVAILABLE", "Google Play Billing is unavailable. Please try again.", true)); return@connect }
            val query = QueryProductDetailsParams.newBuilder().setProductList(ids.map {
                QueryProductDetailsParams.Product.newBuilder().setProductId(it)
                    .setProductType(BillingClient.ProductType.INAPP).build()
            }).build()
            client.queryProductDetailsAsync(query) { result, response ->
                activity.runOnUiThread {
                    if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                        callback(null, ApiFailure("PRODUCTS_UNAVAILABLE", "Diamond products are not available from Google Play.", true))
                    } else {
                        products.clear()
                        val rows = JSONArray()
                        for (product in response.productDetailsList) {
                            if (product.productId !in ids) continue
                            val offer = product.oneTimePurchaseOfferDetailsList?.firstOrNull()
                                ?: product.oneTimePurchaseOfferDetails ?: continue
                            products[product.productId] = product
                            rows.put(JSONObject().put("product_id", product.productId)
                                .put("price", offer.formattedPrice).put("currency", offer.priceCurrencyCode)
                                .put("price_micros", offer.priceAmountMicros))
                        }
                        callback(JSONObject().put("products", rows), null)
                    }
                }
            }
        }
    }

    fun purchase(id: String, callback: ApiCallback) {
        val user = auth.currentUser
        if (user == null) { callback(null, ApiFailure("AUTH_REQUIRED", "Sign in before buying Diamonds.")); return }
        if (id !in ids) { callback(null, ApiFailure("UNKNOWN_PRODUCT", "Unknown Diamond pack.")); return }
        // Confirm the authenticated backend is operational BEFORE opening payment.
        backend.request("GET", "/v1/profile") { profile, error ->
            if (error != null) { callback(null, error); return@request }
            if (auth.currentUser?.uid != user.uid) { callback(null, ApiFailure("AUTH_CHANGED", "The active player changed.")); return@request }
            val expected = PlayerAuthentication.accountBinding(user.uid)
            val binding = profile?.optJSONObject("profile")?.optString("obfuscated_account_id", "").orEmpty()
            if (binding != expected) { callback(null, ApiFailure("ACCOUNT_BINDING_FAILED", "The store account could not be verified.")); return@request }
            fun launch() {
                val product = products[id]
                if (product == null || !client.isReady) { callback(null, ApiFailure("PRODUCT_NOT_AVAILABLE", "This product has not been made available in Play Console.")); return }
                val params = BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(product)
                product.oneTimePurchaseOfferDetailsList?.firstOrNull()?.let { params.setOfferToken(it.offerToken) }
                val flow = BillingFlowParams.newBuilder().setProductDetailsParamsList(listOf(params.build()))
                    .setObfuscatedAccountId(expected).build()
                val result = client.launchBillingFlow(activity, flow)
                if (result.responseCode == BillingClient.BillingResponseCode.OK)
                    callback(JSONObject().put("status", "launched"), null)
                else callback(null, ApiFailure("PLAY_${result.responseCode}", "Google Play could not open the purchase."))
            }
            if (products.containsKey(id) && client.isReady) launch()
            else listProducts { _, productError -> if (productError != null) callback(null, productError) else launch() }
        }
    }

    private fun handlePurchase(purchase: Purchase) {
        val id = purchase.products.singleOrNull() ?: return
        if (id !in ids) return
        if (purchase.purchaseState == Purchase.PurchaseState.PENDING) {
            event("purchase", JSONObject().put("status", "pending").put("product_id", id)); return
        }
        if (purchase.purchaseState != Purchase.PurchaseState.PURCHASED) return
        if (purchase.quantity != 1) {
            event("purchase", JSONObject().put("status", "verification_failed").put("code", "UNSUPPORTED_QUANTITY")); return
        }
        val user = auth.currentUser ?: return
        if (purchase.accountIdentifiers?.obfuscatedAccountId != PlayerAuthentication.accountBinding(user.uid)) {
            event("purchase", JSONObject().put("status", "verification_failed").put("code", "ACCOUNT_MISMATCH")); return
        }
        savePending(id, purchase.purchaseToken, user.uid)
        verifyPending(id, purchase.purchaseToken, user.uid)
    }

    private fun key(token: String) = MessageDigest.getInstance("SHA-256").digest(token.toByteArray())
        .joinToString("") { "%02x".format(it.toInt() and 255) }

    private fun savePending(product: String, token: String, uid: String) {
        preferences.edit().putString(key(token), JSONObject().put("product_id", product)
            .put("purchase_token", token).put("uid", uid).toString()).apply()
    }

    private fun verifyPending(product: String, token: String, uid: String) {
        if (auth.currentUser?.uid != uid || !processing.add(key(token))) return
        backend.request("POST", "/v1/purchases/verify", JSONObject().put("request_id", "play_" + key(token))
            .put("product_id", product).put("purchase_token", token)) { result, error ->
            processing.remove(key(token))
            if (error != null) {
                event("purchase", JSONObject().put("status", "verification_pending").put("product_id", product).put("code", error.code))
            } else {
                val verified = result != null && result.optString("state") == "PURCHASED" &&
                    (result.optBoolean("granted") || result.optBoolean("already_granted"))
                // Backend atomically grants and persists retryable consume work.
                // Its response replaces the balance; the client never adds currency.
                if (verified && result?.optBoolean("consumption_pending", true) == false)
                    preferences.edit().remove(key(token)).apply()
                val payload = result ?: JSONObject()
                payload.put("product_id", product).put("status", if (verified) "granted" else "pending")
                event("purchase", payload)
            }
        }
    }

    fun reconcile() {
        if (closed || auth.currentUser == null) return
        val uid = auth.currentUser!!.uid
        for ((_, raw) in preferences.all) {
            val item = try { JSONObject(raw as? String ?: continue) } catch (_: Exception) { continue }
            if (item.optString("uid") == uid) verifyPending(item.optString("product_id"), item.optString("purchase_token"), uid)
        }
        connect { ready ->
            if (!ready) return@connect
            client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build()) { result, purchases ->
                activity.runOnUiThread {
                    if (result.responseCode == BillingClient.BillingResponseCode.OK) purchases.forEach(::handlePurchase)
                }
            }
        }
    }

    fun close() { closed = true; main.removeCallbacksAndMessages(null); client.endConnection(); waiting.clear() }
}
