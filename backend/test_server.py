import concurrent.futures
import json
import io
import sqlite3
import tempfile
import unittest
from pathlib import Path

from cryptography.fernet import Fernet
from server import ApiError, GoogleUnavailable, PRODUCTS, Purchase, PurchaseService, clean_token, digest, make_handler


class FakeGoogle:
    def __init__(self):
        self.receipts = {}
        self.finalization_failures = False
        self.verification_failure = False
        self.voided = []

    def add(self, product, token="purchase-token-0123456789", state=0, **kwargs):
        self.receipts[(product, token)] = Purchase(state, **kwargs)
        return token

    def verify(self, product, token):
        if self.verification_failure:
            raise GoogleUnavailable("test_outage")
        try:
            return self.receipts[(product, token)]
        except KeyError:
            raise ApiError(422, "google_purchase_invalid") from None

    def finalize(self, product, token, consumable):
        if self.finalization_failures:
            raise GoogleUnavailable("test_outage")
        value = self.verify(product, token)
        self.receipts[(product, token)] = Purchase(value.state, acknowledged=True, consumed=consumable,
            quantity=value.quantity, account_id=value.account_id)

    def voided_tokens(self):
        return self.voided[:]


class PurchaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temp.name) / "ledger.sqlite3")
        self.key = Fernet.generate_key()
        self.google = FakeGoogle()
        self.service = PurchaseService(self.path, self.key, self.google)
        self.login = self.service.create_session()
        self.session = self.service.authenticate(self.login["session_token"])

    def tearDown(self):
        self.temp.cleanup()

    def assert_error(self, code, method, *args):
        with self.assertRaises(ApiError) as caught:
            method(*args)
        self.assertEqual(code, caught.exception.code)

    def test_verified_consumable_granted_once_across_retries_and_restart(self):
        token = self.google.add("coin_pack_small")
        first = self.service.verify_purchase(self.session, "coin_pack_small", token)
        self.assertEqual(1000, first["profile"]["wallet_coins"])
        self.assertFalse(first["finalization_pending"])
        second = self.service.verify_purchase(self.session, "coin_pack_small", token)
        self.assertEqual(1000, second["profile"]["wallet_coins"])
        restarted = PurchaseService(self.path, self.key, self.google)
        self.assertEqual(1000, restarted.verify_purchase(self.session, "coin_pack_small", token)["profile"]["wallet_coins"])

    def test_parallel_duplicate_grants_exactly_once(self):
        token = self.google.add("coin_pack_medium")
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            results = list(executor.map(lambda _: self.service.verify_purchase(self.session, "coin_pack_medium", token), range(24)))
        self.assertTrue(all(result["status"] == "granted" for result in results))
        self.assertEqual(6000, self.service.profile(self.session)["wallet_coins"])
        with sqlite3.connect(self.path) as db:
            self.assertEqual(1, db.execute("SELECT count(*) FROM wallet_events WHERE kind='grant'").fetchone()[0])

    def test_pending_and_parental_approval_never_grant(self):
        token = self.google.add("starter_pack", state=2)
        result = self.service.verify_purchase(self.session, "starter_pack", token)
        self.assertEqual("pending", result["status"])
        self.assertEqual(0, result["profile"]["wallet_coins"])
        self.assertEqual([], result["profile"]["entitlements"])
        self.google.add("starter_pack", token, state=0)
        result = self.service.verify_purchase(self.session, "starter_pack", token)
        self.assertEqual(2000, result["profile"]["wallet_coins"])

    def test_cancelled_forged_product_and_quantity_rejected(self):
        token = self.google.add("coin_pack_small", state=1)
        self.assert_error("purchase_cancelled", self.service.verify_purchase, self.session, "coin_pack_small", token)
        self.assert_error("google_purchase_invalid", self.service.verify_purchase, self.session, "coin_pack_large", token)
        self.assert_error("unknown_product", self.service.verify_purchase, self.session, "free-million-coins", token)
        self.google.add("coin_pack_small", token, quantity=2)
        self.assert_error("unsupported_purchase_quantity", self.service.verify_purchase, self.session, "coin_pack_small", token)
        self.assertEqual(0, self.service.profile(self.session)["wallet_coins"])

    def test_verification_outage_has_no_grant(self):
        token = self.google.add("character_neon")
        self.google.verification_failure = True
        with self.assertRaises(GoogleUnavailable):
            self.service.verify_purchase(self.session, "character_neon", token)
        self.assertEqual([], self.service.profile(self.session)["entitlements"])

    def test_account_binding_for_initial_purchase(self):
        token = self.google.add("coin_pack_large", account_id="other-account")
        self.assert_error("purchase_account_mismatch", self.service.verify_purchase, self.session, "coin_pack_large", token)
        self.google.add("coin_pack_large", token, account_id=self.login["obfuscated_account_id"])
        self.assertEqual(15000, self.service.verify_purchase(self.session, "coin_pack_large", token)["profile"]["wallet_coins"])

    def test_consumable_cannot_transfer_to_other_session(self):
        token = self.google.add("coin_pack_small")
        self.service.verify_purchase(self.session, "coin_pack_small", token)
        other = self.service.create_session()
        other_id = self.service.authenticate(other["session_token"])
        self.assert_error("consumable_owned_by_other_session", self.service.verify_purchase, other_id, "coin_pack_small", token)
        self.assertEqual(0, self.service.profile(other_id)["wallet_coins"])

    def test_restore_premium_and_starter_never_regrants_coins(self):
        token = self.google.add("starter_pack", account_id=self.login["obfuscated_account_id"])
        self.service.verify_purchase(self.session, "starter_pack", token)
        other = self.service.authenticate(self.service.create_session()["session_token"])
        restored = self.service.verify_purchase(other, "starter_pack", token)
        self.assertEqual(["astronaut"], restored["profile"]["entitlements"])
        self.assertEqual(0, restored["profile"]["wallet_coins"])
        self.assertEqual(2000, self.service.profile(self.session)["wallet_coins"])

    def test_refund_idempotent_and_revokes_every_restore_claim(self):
        token = self.google.add("starter_pack")
        self.service.verify_purchase(self.session, "starter_pack", token)
        other = self.service.authenticate(self.service.create_session()["session_token"])
        self.service.verify_purchase(other, "starter_pack", token)
        self.assertTrue(self.service.refund(token))
        self.assertFalse(self.service.refund(token))
        for session in [self.session, other]:
            self.assertEqual([], self.service.profile(session)["entitlements"])
            self.assertEqual(0, self.service.profile(session)["wallet_coins"])
        self.assert_error("purchase_refunded", self.service.verify_purchase, self.session, "starter_pack", token)

    def test_refund_one_source_preserves_second_valid_item_source(self):
        starter = self.google.add("starter_pack")
        character = self.google.add("character_astronaut", "another-token-1234567890")
        self.service.verify_purchase(self.session, "starter_pack", starter)
        self.service.verify_purchase(self.session, "character_astronaut", character)
        self.service.refund(starter)
        self.assertEqual(["astronaut"], self.service.profile(self.session)["entitlements"])

    def test_finalize_failure_durable_retry_and_voided_reconciliation(self):
        token = self.google.add("coin_pack_small")
        self.google.finalization_failures = True
        result = self.service.verify_purchase(self.session, "coin_pack_small", token)
        self.assertTrue(result["finalization_pending"])
        self.assertEqual(1000, result["profile"]["wallet_coins"])
        self.google.finalization_failures = False
        self.assertEqual({"refunded": 0, "finalized": 1, "still_pending": 0}, self.service.reconcile())
        self.google.voided = [token]
        self.assertEqual(1, self.service.reconcile()["refunded"])
        self.assertEqual(0, self.service.profile(self.session)["wallet_coins"])
        self.assertEqual(0, self.service.reconcile()["refunded"])

    def test_receipt_cipher_and_session_hash_only_in_database(self):
        token = self.google.add("coin_pack_small")
        self.service.verify_purchase(self.session, "coin_pack_small", token)
        with sqlite3.connect(self.path) as db:
            stored = db.execute("SELECT token_cipher FROM purchases").fetchone()[0]
            session_hash = db.execute("SELECT token_hash FROM sessions").fetchone()[0]
        self.assertNotIn(token.encode(), stored)
        self.assertEqual(token, Fernet(self.key).decrypt(stored).decode())
        self.assertEqual(digest(self.login["session_token"]), session_hash)

    def test_invalid_auth_and_purchase_inputs(self):
        self.assert_error("unauthorized", self.service.authenticate, "nope")
        self.assert_error("unauthorized", self.service.authenticate, "x" * 43)
        for token in [None, "tiny", "bad\n" + "x" * 50, "x" * 5000]:
            self.assert_error("invalid_purchase_token", clean_token, token)

    def test_consumed_unknown_receipt_does_not_mint(self):
        token = self.google.add("coin_pack_small", consumed=True)
        self.assert_error("unrecognized_consumed_purchase", self.service.verify_purchase, self.session, "coin_pack_small", token)

    def test_paid_wallet_unlock_concurrent_retries_charge_once(self):
        token = self.google.add("coin_pack_medium")
        self.service.verify_purchase(self.session, "coin_pack_medium", token)
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            results = list(executor.map(lambda _: self.service.unlock_style(self.session, "sprinter"), range(20)))
        self.assertTrue(all(result["status"] == "unlocked" for result in results))
        self.assertEqual(4800, self.service.profile(self.session)["wallet_coins"])
        self.assertEqual(["sprinter"], self.service.profile(self.session)["entitlements"])
        self.service.unlock_style(self.session, "robot")
        self.assertEqual(1300, self.service.profile(self.session)["wallet_coins"])

    def test_paid_wallet_cannot_go_negative_on_spend(self):
        self.assert_error("insufficient_paid_coins", self.service.unlock_style, self.session, "sprinter")
        self.assert_error("unknown_coin_unlock", self.service.unlock_style, self.session, "astronaut")
        self.assertEqual(0, self.service.profile(self.session)["wallet_coins"])

    def test_refund_debt_suspends_paid_coin_cosmetics(self):
        token = self.google.add("coin_pack_medium")
        self.service.verify_purchase(self.session, "coin_pack_medium", token)
        self.service.unlock_style(self.session, "robot")
        self.service.refund(token)
        profile = self.service.profile(self.session)
        self.assertEqual(0, profile["wallet_coins"])
        self.assertEqual(3500, profile["wallet_debt"])
        self.assertEqual([], profile["entitlements"])
        self.assert_error("insufficient_paid_coins", self.service.unlock_style, self.session, "sprinter")
        self.google.add("coin_pack_medium", "repayment-token-12345678")
        self.service.verify_purchase(self.session, "coin_pack_medium", "repayment-token-12345678")
        self.assertEqual(["robot"], self.service.profile(self.session)["entitlements"])

    def test_http_body_limits_and_fields_without_network(self):
        handler_class = make_handler(self.service)
        handler = object.__new__(handler_class)
        cases = [
            ({"Content-Type": "text/plain", "Content-Length": "2"}, b"{}", "json_required"),
            ({"Content-Type": "application/json", "Content-Length": "20000"}, b"{}", "body_too_large"),
            ({"Content-Type": "application/json", "Content-Length": "bad"}, b"{}", "invalid_content_length"),
            ({"Content-Type": "application/json", "Content-Length": "2"}, b"[]", "object_required"),
            ({"Content-Type": "application/json", "Content-Length": "2"}, b"{{", "invalid_json"),
            ({"Content-Type": "application/json", "Transfer-Encoding": "chunked"}, b"{}", "unsupported_transfer_encoding"),
        ]
        for headers, raw, expected in cases:
            handler.headers = headers
            handler.rfile = io.BytesIO(raw)
            self.assert_error(expected, handler._body)
        raw = json.dumps({"product_id": "coin_pack_small", "purchase_token": "fake-token-1234567890", "coins": 99999}).encode()
        handler.headers = {"Content-Type": "application/json", "Content-Length": str(len(raw)),
            "Authorization": "Bearer " + self.login["session_token"]}
        handler.rfile = io.BytesIO(raw)
        handler.command, handler.path = "POST", "/v1/purchases/verify"
        self.assert_error("invalid_purchase_fields", handler._route)

    def test_http_failures_do_not_return_google_exception_details(self):
        handler_class = make_handler(self.service)
        handler = object.__new__(handler_class)
        class Connection:
            def settimeout(self, timeout):
                pass
        handler.connection = Connection()
        sent = []
        handler._send = lambda status, result: sent.append((status, result))
        def unavailable():
            raise GoogleUnavailable("secret receipt token that must not reach response")
        handler._route = unavailable
        handler._handle()
        self.assertEqual([(503, {"error": "purchase_verification_unavailable"})], sent)


if __name__ == "__main__":
    unittest.main()
