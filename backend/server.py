#!/usr/bin/env python3
"""Subway Runner purchase service. No game currency is accepted from a client."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import secrets
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from contextlib import contextmanager
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

PRODUCTS = {
    "coin_pack_small": {"coins": 1000, "items": [], "consumable": True},
    "coin_pack_medium": {"coins": 6000, "items": [], "consumable": True},
    "coin_pack_large": {"coins": 15000, "items": [], "consumable": True},
    "starter_pack": {"coins": 2000, "items": ["astronaut"], "consumable": False},
    "character_astronaut": {"coins": 0, "items": ["astronaut"], "consumable": False},
    "character_neon": {"coins": 0, "items": ["neon"], "consumable": False},
    "remove_forced_ads": {"coins": 0, "items": ["remove_forced_ads"], "consumable": False},
}
COIN_UNLOCKS = {"sprinter": 1200, "robot": 3500}
MAX_BODY = 16_384


class ApiError(Exception):
    def __init__(self, status: int, code: str):
        self.status, self.code = status, code
        super().__init__(code)


class GoogleUnavailable(Exception):
    pass


@dataclass(frozen=True)
class Purchase:
    state: int  # Google: 0 purchased, 1 cancelled, 2 pending.
    acknowledged: bool = False
    consumed: bool = False
    quantity: int = 1
    account_id: str | None = None


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def clean_token(value: object) -> str:
    if not isinstance(value, str) or not 16 <= len(value) <= 4096:
        raise ApiError(400, "invalid_purchase_token")
    if any(ord(c) < 33 or ord(c) > 126 for c in value):
        raise ApiError(400, "invalid_purchase_token")
    return value


class GooglePlay:
    """Real Play Developer API adapter; never logs tokens, credentials or response bodies."""

    def __init__(self, package: str):
        self.package = package
        self._token = ""
        self._expires = 0.0
        self._lock = threading.Lock()

    def _access_token(self) -> str:
        # Short-lived token injection is useful with managed workload identity.
        injected = os.environ.get("GOOGLE_PLAY_ACCESS_TOKEN")
        if injected:
            return injected
        with self._lock:
            if self._expires > time.time() + 60:
                return self._token
            credential_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
            if not credential_path:
                raise GoogleUnavailable("credentials_not_configured")
            try:
                credential = json.loads(Path(credential_path).read_text())
                if credential.get("type") != "service_account":
                    raise ValueError("service_account_required")
                now = int(time.time())
                enc = lambda value: base64.urlsafe_b64encode(value).rstrip(b"=")
                header = enc(json.dumps({"alg": "RS256", "typ": "JWT"}, separators=(",", ":")).encode())
                claims = enc(json.dumps({"iss": credential["client_email"],
                    "scope": "https://www.googleapis.com/auth/androidpublisher",
                    "aud": "https://oauth2.googleapis.com/token", "iat": now, "exp": now + 3600},
                    separators=(",", ":")).encode())
                signing_input = header + b"." + claims
                key = serialization.load_pem_private_key(credential["private_key"].encode(), None)
                assertion = signing_input + b"." + enc(key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256()))
                request = urllib.request.Request("https://oauth2.googleapis.com/token", data=urllib.parse.urlencode({
                    "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion.decode()
                }).encode(), headers={"Content-Type": "application/x-www-form-urlencoded"})
                with urllib.request.urlopen(request, timeout=15) as response:
                    result = json.load(response)
                self._token = result["access_token"]
                self._expires = time.time() + int(result.get("expires_in", 3600))
                return self._token
            except (OSError, ValueError, KeyError, TypeError, urllib.error.URLError) as exc:
                raise GoogleUnavailable("authentication_unavailable") from None

    def _request(self, suffix: str, data: dict | None = None) -> dict:
        url = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/" + urllib.parse.quote(self.package, safe="") + suffix
        request = urllib.request.Request(url,
            data=None if data is None else json.dumps(data).encode(),
            headers={"Authorization": "Bearer " + self._access_token(), "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                raw = response.read(1_048_576)
            return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as exc:
            if exc.code in (400, 404, 410):
                raise ApiError(422, "google_purchase_invalid") from None
            raise GoogleUnavailable("google_api_unavailable") from None
        except (OSError, ValueError, urllib.error.URLError):
            raise GoogleUnavailable("google_api_unavailable") from None

    def _path(self, product: str, token: str) -> str:
        return "/purchases/products/" + urllib.parse.quote(product, safe="") + "/tokens/" + urllib.parse.quote(token, safe="")

    def verify(self, product: str, token: str) -> Purchase:
        result = self._request(self._path(product, token))
        state = result.get("purchaseState")
        if state not in (0, 1, 2):
            raise ApiError(422, "google_purchase_invalid")
        return Purchase(state=state, acknowledged=result.get("acknowledgementState") == 1,
            consumed=result.get("consumptionState") == 1, quantity=int(result.get("quantity", 1)),
            account_id=result.get("obfuscatedExternalAccountId"))

    def finalize(self, product: str, token: str, consumable: bool) -> None:
        current = self.verify(product, token)
        if current.state != 0:
            raise ApiError(409, "purchase_not_purchased")
        if consumable:
            if not current.consumed:
                self._request(self._path(product, token) + ":consume", {})
        elif not current.acknowledged:
            self._request(self._path(product, token) + ":acknowledge", {})

    def voided_tokens(self) -> list[str]:
        # Google retains a limited history. Run at least daily, never just at release.
        tokens: list[str] = []
        page = None
        for _ in range(100):
            query = {"type": "0", "maxResults": "1000", "includeQuantityBasedPartialRefund": "true"}
            if page:
                query["token"] = page
            result = self._request("/purchases/voidedpurchases?" + urllib.parse.urlencode(query))
            tokens.extend(item["purchaseToken"] for item in result.get("voidedPurchases", []) if "purchaseToken" in item)
            page = result.get("tokenPagination", {}).get("nextPageToken")
            if not page:
                return tokens
        raise GoogleUnavailable("voided_pagination_limit")


class PurchaseService:
    def __init__(self, database: str, cipher_key: bytes, google: GooglePlay):
        self.database, self.cipher, self.google = database, Fernet(cipher_key), google
        with self._db() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, coins INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS purchases(token_hash TEXT PRIMARY KEY, token_cipher BLOB NOT NULL, product TEXT NOT NULL,
                    owner TEXT NOT NULL REFERENCES sessions(id), coins INTEGER NOT NULL, consumable INTEGER NOT NULL,
                    state TEXT NOT NULL CHECK(state IN ('granted','voided')), finalized INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS claims(session_id TEXT NOT NULL REFERENCES sessions(id), purchase_hash TEXT NOT NULL REFERENCES purchases(token_hash),
                    item TEXT NOT NULL, PRIMARY KEY(session_id,purchase_hash,item));
                CREATE TABLE IF NOT EXISTS wallet_events(purchase_hash TEXT NOT NULL, kind TEXT NOT NULL, amount INTEGER NOT NULL,
                    PRIMARY KEY(purchase_hash,kind));
                CREATE TABLE IF NOT EXISTS coin_unlocks(session_id TEXT NOT NULL REFERENCES sessions(id), item TEXT NOT NULL,
                    cost INTEGER NOT NULL, PRIMARY KEY(session_id,item));
            """)

    @contextmanager
    def _db(self):
        db = sqlite3.connect(self.database, timeout=20)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def account_id(session_id: str) -> str:
        return digest("subway-runner:" + session_id)

    def create_session(self) -> dict:
        token, identifier = secrets.token_urlsafe(32), secrets.token_hex(16)
        with self._db() as db:
            db.execute("INSERT INTO sessions(id,token_hash) VALUES(?,?)", (identifier, digest(token)))
        return {"session_token": token, "obfuscated_account_id": self.account_id(identifier),
            "profile": {"wallet_coins": 0, "entitlements": []}}

    def authenticate(self, token: str) -> str:
        if not isinstance(token, str) or not 30 <= len(token) <= 200:
            raise ApiError(401, "unauthorized")
        with self._db() as db:
            session = db.execute("SELECT id FROM sessions WHERE token_hash=?", (digest(token),)).fetchone()
        if not session:
            raise ApiError(401, "unauthorized")
        return session["id"]

    def profile(self, session_id: str) -> dict:
        with self._db() as db:
            row = db.execute("SELECT coins FROM sessions WHERE id=?", (session_id,)).fetchone()
            if not row:
                raise ApiError(401, "unauthorized")
            items = [r[0] for r in db.execute("SELECT DISTINCT c.item FROM claims c JOIN purchases p ON p.token_hash=c.purchase_hash "
                "WHERE c.session_id=? AND p.state='granted' ORDER BY c.item", (session_id,))]
            # Chargeback debt suspends cosmetics funded by that paid coin bank until
            # the balance is repaid. Free in-game earned coins never enter this bank.
            if row["coins"] >= 0:
                items += [r[0] for r in db.execute("SELECT item FROM coin_unlocks WHERE session_id=?", (session_id,))]
        return {"wallet_coins": max(0, row["coins"]), "wallet_debt": max(0, -row["coins"]), "entitlements": sorted(set(items))}

    def unlock_style(self, session_id: str, style: object) -> dict:
        if not isinstance(style, str) or style not in COIN_UNLOCKS:
            raise ApiError(400, "unknown_coin_unlock")
        with self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            balance = db.execute("SELECT coins FROM sessions WHERE id=?", (session_id,)).fetchone()
            if not balance:
                raise ApiError(401, "unauthorized")
            owned = db.execute("SELECT 1 FROM coin_unlocks WHERE session_id=? AND item=?", (session_id, style)).fetchone()
            if not owned:
                price = COIN_UNLOCKS[style]
                if balance["coins"] < price:
                    raise ApiError(409, "insufficient_paid_coins")
                db.execute("UPDATE sessions SET coins=coins-? WHERE id=?", (price, session_id))
                db.execute("INSERT INTO coin_unlocks VALUES(?,?,?)", (session_id, style, price))
        return {"status": "unlocked", "profile": self.profile(session_id)}

    def verify_purchase(self, session_id: str, product: object, token: object) -> dict:
        if not isinstance(product, str) or product not in PRODUCTS:
            raise ApiError(400, "unknown_product")
        token = clean_token(token)
        purchase = self.google.verify(product, token)  # Never trust a client purchase state.
        if purchase.quantity != 1:
            raise ApiError(422, "unsupported_purchase_quantity")
        token_hash, specification = digest(token), PRODUCTS[product]
        if purchase.state == 2:
            return {"status": "pending", "profile": self.profile(session_id)}
        if purchase.state != 0:
            self.refund(token)
            raise ApiError(409, "purchase_cancelled")
        with self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute("SELECT * FROM purchases WHERE token_hash=?", (token_hash,)).fetchone()
            if existing:
                if existing["product"] != product:
                    raise ApiError(409, "purchase_product_mismatch")
                if existing["state"] != "granted":
                    raise ApiError(409, "purchase_refunded")
                if existing["consumable"] and existing["owner"] != session_id:
                    raise ApiError(409, "consumable_owned_by_other_session")
            else:
                # For first claims honour an account binding when the app supplied one.
                # Nonconsumable restores below use the verified receipt as bearer proof.
                if purchase.account_id and purchase.account_id != self.account_id(session_id):
                    raise ApiError(409, "purchase_account_mismatch")
                if purchase.consumed:
                    raise ApiError(409, "unrecognized_consumed_purchase")
                if not specification["consumable"]:
                    duplicate = db.execute("SELECT 1 FROM purchases WHERE owner=? AND product=? AND state='granted'", (session_id, product)).fetchone()
                    if duplicate:
                        raise ApiError(409, "nonconsumable_already_owned")
                db.execute("INSERT INTO purchases(token_hash,token_cipher,product,owner,coins,consumable,state) VALUES(?,?,?,?,?,?,'granted')",
                    (token_hash, self.cipher.encrypt(token.encode()), product, session_id, specification["coins"], int(specification["consumable"])))
                db.execute("INSERT INTO wallet_events(purchase_hash,kind,amount) VALUES(?,'grant',?)", (token_hash, specification["coins"]))
                db.execute("UPDATE sessions SET coins=coins+? WHERE id=?", (specification["coins"], session_id))
            for item in specification["items"]:
                db.execute("INSERT OR IGNORE INTO claims VALUES(?,?,?)", (session_id, token_hash, item))
        # Grant and durable finalization work are committed together. Failures can be retried.
        finalized = self.finalize_one(token_hash)
        return {"status": "granted", "finalization_pending": not finalized, "profile": self.profile(session_id)}

    def finalize_one(self, token_hash: str) -> bool:
        with self._db() as db:
            row = db.execute("SELECT * FROM purchases WHERE token_hash=?", (token_hash,)).fetchone()
        if not row or row["state"] != "granted":
            return False
        if row["finalized"]:
            return True
        token = self.cipher.decrypt(row["token_cipher"]).decode()
        try:
            self.google.finalize(row["product"], token, bool(row["consumable"]))
        except (GoogleUnavailable, ApiError):
            return False
        with self._db() as db:
            db.execute("UPDATE purchases SET finalized=1 WHERE token_hash=? AND state='granted'", (token_hash,))
        return True

    def refund(self, token: str) -> bool:
        token_hash = digest(token)
        with self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM purchases WHERE token_hash=?", (token_hash,)).fetchone()
            if not row or row["state"] == "voided":
                return False
            db.execute("UPDATE purchases SET state='voided' WHERE token_hash=?", (token_hash,))
            db.execute("INSERT INTO wallet_events(purchase_hash,kind,amount) VALUES(?,'refund',?)", (token_hash, -row["coins"]))
            db.execute("UPDATE sessions SET coins=coins-? WHERE id=?", (row["coins"], row["owner"]))
            # Claims are retained for audit but profile filters every refunded receipt.
        return True

    def reconcile(self) -> dict:
        # First revoke, then finalize remaining grants. Query Google rather than accepting
        # unauthenticated webhook/client refund declarations.
        reversed_count = sum(self.refund(token) for token in self.google.voided_tokens())
        with self._db() as db:
            pending = [r[0] for r in db.execute("SELECT token_hash FROM purchases WHERE state='granted' AND finalized=0")]
        finalized = sum(self.finalize_one(token_hash) for token_hash in pending)
        return {"refunded": reversed_count, "finalized": finalized, "still_pending": len(pending) - finalized}


def make_handler(service: PurchaseService):
    class Handler(BaseHTTPRequestHandler):
        server_version = "SubwayRunner"
        sys_version = ""

        def log_message(self, format, *args):
            # Default request log includes attacker-controlled paths. Production edge
            # may log status/latency, but must redact Authorization and purchase tokens.
            pass

        def _send(self, status: int, value: dict):
            raw = json.dumps(value, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def _body(self) -> dict:
            if self.headers.get("Transfer-Encoding"):
                raise ApiError(400, "unsupported_transfer_encoding")
            if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
                raise ApiError(415, "json_required")
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                raise ApiError(400, "invalid_content_length") from None
            if length < 0 or length > MAX_BODY:
                raise ApiError(413, "body_too_large")
            try:
                value = json.loads(self.rfile.read(length))
            except (ValueError, UnicodeDecodeError):
                raise ApiError(400, "invalid_json") from None
            if not isinstance(value, dict):
                raise ApiError(400, "object_required")
            return value

        def _session(self) -> str:
            header = self.headers.get("Authorization", "")
            if not header.startswith("Bearer "):
                raise ApiError(401, "unauthorized")
            return service.authenticate(header[7:])

        def _route(self):
            if self.command == "GET" and self.path == "/health":
                return {"status": "ok", "service": "subway-runner-purchases"}
            if self.command == "POST" and self.path == "/v1/session":
                body = self._body()
                if body:
                    raise ApiError(400, "unexpected_fields")
                return service.create_session()
            if self.command == "GET" and self.path == "/v1/profile":
                return {"profile": service.profile(self._session())}
            if self.command == "POST" and self.path == "/v1/purchases/verify":
                session, body = self._session(), self._body()
                if set(body) != {"product_id", "purchase_token"}:
                    raise ApiError(400, "invalid_purchase_fields")
                return service.verify_purchase(session, body["product_id"], body["purchase_token"])
            if self.command == "POST" and self.path == "/v1/store/unlock":
                session, body = self._session(), self._body()
                if set(body) != {"style_id"}:
                    raise ApiError(400, "invalid_unlock_fields")
                return service.unlock_style(session, body["style_id"])
            raise ApiError(404, "not_found")

        def _handle(self):
            self.connection.settimeout(15)
            try:
                self._send(200, self._route())
            except ApiError as exc:
                self._send(exc.status, {"error": exc.code})
            except GoogleUnavailable:
                self._send(503, {"error": "purchase_verification_unavailable"})
            except (BrokenPipeError, ConnectionResetError, TimeoutError):
                pass
            except Exception:
                self._send(500, {"error": "internal_error"})

        do_GET = do_POST = _handle
    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--reconcile", action="store_true")
    args = parser.parse_args()
    package = os.environ.get("PLAY_PACKAGE_NAME", "")
    if not re.fullmatch(r"[a-zA-Z]\w*(?:\.[a-zA-Z]\w*){2,}", package):
        raise SystemExit("Set PLAY_PACKAGE_NAME to the final Play application ID.")
    cipher_key = os.environ.get("PURCHASE_TOKEN_ENCRYPTION_KEY", "").encode()
    if not cipher_key:
        raise SystemExit("PURCHASE_TOKEN_ENCRYPTION_KEY is required; preserve it with database backups.")
    if not (os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") or os.environ.get("GOOGLE_PLAY_ACCESS_TOKEN")):
        raise SystemExit("Configure Google Play API authentication before starting this service.")
    service = PurchaseService(os.environ.get("DATABASE_PATH", "purchases.sqlite3"), cipher_key, GooglePlay(package))
    if args.reconcile:
        print(json.dumps(service.reconcile()))
        return
    server = ThreadingHTTPServer((os.environ.get("BIND_HOST", "127.0.0.1"), int(os.environ.get("PORT", "8080"))), make_handler(service))
    server.daemon_threads = True
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
