#!/usr/bin/env python3
"""Independent byte-level audit of the offline Subway Runner APK.

Does not import the builder. Passing this is not an Android PackageManager/ART
installation test; that still requires an Android device or emulator.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import tempfile
import zipfile
import zlib
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

ANDROID = "http://schemas.android.com/apk/res/android"
ATTRS = {
    "theme": 0x01010000, "label": 0x01010001, "icon": 0x01010002,
    "name": 0x01010003, "enabled": 0x0101000e, "debuggable": 0x0101000f,
    "exported": 0x01010010, "screenOrientation": 0x0101001e,
    "configChanges": 0x0101001f, "minSdkVersion": 0x0101020c,
    "versionCode": 0x0101021b, "versionName": 0x0101021c,
    "targetSdkVersion": 0x01010270, "allowBackup": 0x01010280,
    "hardwareAccelerated": 0x010102d3, "supportsRtl": 0x010103af,
    "usesCleartextTraffic": 0x010104ec,
}

def need(ok: bool, message: str) -> None:
    if not ok:
        raise ValueError(message)

def u16(data: bytes, offset: int) -> int:
    return struct.unpack_from("<H", data, offset)[0]

def u32(data: bytes, offset: int) -> int:
    return struct.unpack_from("<I", data, offset)[0]

def lp(data: bytes, offset: int = 0) -> tuple[bytes, int]:
    size = u32(data, offset)
    end = offset + 4 + size
    need(end <= len(data), "Length-prefixed record overrun")
    return data[offset + 4:end], end

def records(data: bytes):
    at = 0
    while at < len(data):
        value, at = lp(data, at)
        yield value
    need(at == len(data), "Length-prefixed sequence has trailing bytes")

def apk_v2(data: bytes) -> bytes:
    eocd = data.rfind(b"PK\x05\x06", max(0, len(data) - 65557))
    need(eocd >= 0, "ZIP end of central directory missing")
    need(eocd + 22 + u16(data, eocd + 20) == len(data), "ZIP trailing bytes/EOCD size mismatch")
    need(u16(data, eocd + 4) == 0 and u16(data, eocd + 6) == 0, "Multi-disk ZIP is unsupported")
    cd = u32(data, eocd + 16)
    need(cd + u32(data, eocd + 12) == eocd, "Central directory extent mismatch")
    need(data[cd - 16:cd] == b"APK Sig Block 42", "APK signing block footer missing")
    size = struct.unpack_from("<Q", data, cd - 24)[0]
    start = cd - size - 8
    need(start >= 0 and struct.unpack_from("<Q", data, start)[0] == size, "APK block size mismatch")
    at, v2 = start + 8, None
    while at < cd - 24:
        length = struct.unpack_from("<Q", data, at)[0]
        need(length >= 4 and at + 8 + length <= cd - 24, "Malformed APK block pair")
        identifier = u32(data, at + 8)
        if identifier == 0x7109871a:
            need(v2 is None, "Duplicate v2 signer block")
            v2 = data[at + 12:at + 8 + length]
        at += 8 + length
    need(at == cd - 24 and v2 is not None, "APK v2 block absent or misaligned")
    signer_sequence, consumed = lp(v2)
    need(consumed == len(v2), "APK v2 trailing data")
    signers = list(records(signer_sequence))
    need(len(signers) == 1, "Expected exactly one APK signer")
    signer = signers[0]
    signed_data, at = lp(signer)
    signatures, at = lp(signer, at)
    public_key, at = lp(signer, at)
    need(at == len(signer), "Trailing signer data")
    digest_records, at = lp(signed_data)
    certificate_records, at = lp(signed_data, at)
    attributes, at = lp(signed_data, at)
    need(at == len(signed_data), "Trailing signed data")
    list(records(attributes))
    certs = list(records(certificate_records))
    need(len(certs) == 1, "Expected one leaf APK certificate")
    cert = x509.load_der_x509_certificate(certs[0])
    expected_key = cert.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    need(public_key == expected_key, "APK signer public key does not match certificate")
    signed_digest = None
    for item in records(digest_records):
        digest, end = lp(item, 4)
        need(end == len(item), "Malformed APK digest record")
        if u32(item, 0) == 0x0103:
            signed_digest = digest
    need(signed_digest is not None and len(signed_digest) == 32, "RSA SHA256 APK content digest absent")
    rsa_signature = None
    for item in records(signatures):
        signature, end = lp(item, 4)
        need(end == len(item), "Malformed APK signature record")
        if u32(item, 0) == 0x0103:
            rsa_signature = signature
    need(rsa_signature is not None, "RSA SHA256 APK signature absent")
    cert.public_key().verify(rsa_signature, signed_data, padding.PKCS1v15(), hashes.SHA256())
    patched_eocd = bytearray(data[eocd:])
    struct.pack_into("<I", patched_eocd, 16, start)
    chunks = []
    for section in (data[:start], data[cd:eocd], bytes(patched_eocd)):
        for offset in range(0, len(section), 1024 * 1024):
            chunk = section[offset:offset + 1024 * 1024]
            chunks.append(hashlib.sha256(b"\xa5" + struct.pack("<I", len(chunk)) + chunk).digest())
    calculated = hashlib.sha256(b"\x5a" + struct.pack("<I", len(chunks)) + b"".join(chunks)).digest()
    need(calculated == signed_digest, "APK v2 content digest mismatch")
    print("PASS: independent APK v2 RSA signature, certificate/public key and chunked content digest")
    return certs[0]

def unfold(section: bytes) -> dict[str, str]:
    lines: list[bytes] = []
    for line in section.split(b"\r\n"):
        if line.startswith(b" "):
            need(bool(lines), "JAR header continuation without a header")
            lines[-1] += line[1:]
        elif line:
            lines.append(line)
    return dict(line.decode("utf-8").split(": ", 1) for line in lines)

def sections(blob: bytes) -> list[bytes]:
    need(blob.endswith(b"\r\n\r\n"), "JAR metadata must use CRLF blank-line terminated sections")
    return [section + b"\r\n\r\n" for section in blob[:-4].split(b"\r\n\r\n")]

def digest(blob: bytes) -> str:
    return base64.b64encode(hashlib.sha256(blob).digest()).decode("ascii")

def apk_v1(archive: zipfile.ZipFile, v2_certificate: bytes) -> None:
    names = archive.namelist()
    need(names[0] == "META-INF/MANIFEST.MF", "JAR manifest must be first for streaming readers")
    sf_names = [name for name in names if name.startswith("META-INF/") and name.endswith(".SF")]
    need(len(sf_names) == 1, "Expected exactly one v1 signer")
    sf_name = sf_names[0]
    rsa_name = sf_name[:-3] + ".RSA"
    need(names[:3] == [names[0], sf_name, rsa_name], "Place v1 metadata before APK payload")
    manifest, sf, cms = (archive.read(name) for name in [names[0], sf_name, rsa_name])
    mf_sections = sections(manifest)
    mf_entries = {}
    for raw in mf_sections[1:]:
        values = unfold(raw)
        name = values["Name"]
        need(name not in mf_entries, "Duplicate JAR manifest entry")
        need(values.get("SHA-256-Digest") == digest(archive.read(name)), "JAR payload digest mismatch: " + name)
        mf_entries[name] = raw
    need(set(mf_entries) == {name for name in names if not name.startswith("META-INF/") and not name.endswith("/")}, "Unsigned or missing APK payload")
    sf_sections = sections(sf)
    sf_main = unfold(sf_sections[0])
    need(sf_main.get("SHA-256-Digest-Manifest") == digest(manifest), "JAR whole-manifest digest mismatch")
    need(sf_main.get("X-Android-APK-Signed") == "2", "APK v2 stripping-protection attribute missing")
    sf_entries = {}
    for raw in sf_sections[1:]:
        values = unfold(raw)
        name = values["Name"]
        need(name not in sf_entries and name in mf_entries, "Malformed v1 signature file names")
        need(values.get("SHA-256-Digest") == digest(mf_entries[name]), "JAR manifest-section digest mismatch: " + name)
        sf_entries[name] = True
    need(set(sf_entries) == set(mf_entries), "Incomplete JAR signature sections")
    from cryptography.hazmat.primitives.serialization.pkcs7 import load_der_pkcs7_certificates
    certificates = load_der_pkcs7_certificates(cms)
    need(len(certificates) == 1 and certificates[0].public_bytes(serialization.Encoding.DER) == v2_certificate, "v1/v2 signer identities differ")
    with tempfile.TemporaryDirectory(prefix="subway-apk-audit-") as temporary:
        root = Path(temporary)
        (root / "signature.der").write_bytes(cms)
        (root / "signature.sf").write_bytes(sf)
        result = subprocess.run(["openssl", "cms", "-verify", "-binary", "-inform", "DER", "-in", str(root / "signature.der"), "-content", str(root / "signature.sf"), "-noverify", "-out", str(root / "verified")], capture_output=True, text=True)
        need(result.returncode == 0, "OpenSSL CMS verification failed: " + result.stderr.strip())
        need((root / "verified").read_bytes() == sf, "CMS authenticated content mismatch")
    print("PASS: v1 payload/manifest-section digests and independent OpenSSL CMS signature")

def manifest_xml(data: bytes) -> str:
    need(u16(data, 0) == 3 and u16(data, 2) == 8 and u32(data, 4) == len(data), "Manifest is not binary Android XML")
    strings: list[str] = []
    resources: list[int] = []
    stack: list[dict] = []
    nodes: list[dict] = []
    at = 8
    def s(index: int) -> str | None:
        return None if index == 0xffffffff else strings[index]
    def length8(offset: int):
        first = data[offset]
        return (((first & 0x7f) << 8) | data[offset + 1], offset + 2) if first & 0x80 else (first, offset + 1)
    def length16(offset: int):
        first = u16(data, offset)
        return (((first & 0x7fff) << 16) | u16(data, offset + 2), offset + 4) if first & 0x8000 else (first, offset + 2)
    while at < len(data):
        kind, header, size = struct.unpack_from("<HHI", data, at)
        need(size >= header >= 8 and at + size <= len(data) and size % 4 == 0, "Invalid binary XML chunk")
        if kind == 1:
            count, styles, flags, start, style_start = struct.unpack_from("<5I", data, at + 8)
            need(header == 28 and styles == 0 and style_start == 0, "Unexpected manifest string-pool styles")
            for i in range(count):
                offset = at + start + u32(data, at + header + i * 4)
                if flags & 0x100:
                    chars, offset = length8(offset)
                    length, offset = length8(offset)
                    value = data[offset:offset + length].decode("utf-8")
                    need(data[offset + length] == 0 and len(value.encode("utf-16-le")) // 2 == chars, "Malformed UTF8 manifest string")
                else:
                    chars, offset = length16(offset)
                    value = data[offset:offset + chars * 2].decode("utf-16-le")
                    need(u16(data, offset + chars * 2) == 0, "Malformed UTF16 manifest string")
                strings.append(value)
        elif kind == 0x180:
            resources = list(struct.unpack_from("<" + "I" * ((size - header) // 4), data, at + header))
        elif kind == 0x102:
            need(header == 16 and size >= 36, "Invalid XML start-node header")
            namespace, name = struct.unpack_from("<II", data, at + 16)
            attr_start, attr_size, count = struct.unpack_from("<HHH", data, at + 24)
            need(attr_size == 20 and at + 16 + attr_start + count * attr_size <= at + size, "Invalid XML attribute extent")
            node = {"name": s(name), "attrs": {}, "parent": stack[-1] if stack else None}
            for i in range(count):
                offset = at + 16 + attr_start + i * attr_size
                ns, name_index, raw, typed_size, zero, value_type, value = struct.unpack_from("<IIIHBBI", data, offset)
                attr_name = s(name_index)
                need(typed_size == 8 and zero == 0, "Invalid XML typed value")
                if s(ns) == ANDROID:
                    need(name_index < len(resources) and resources[name_index] == ATTRS[attr_name], "Incorrect framework resource ID: " + attr_name)
                    key = "android:" + attr_name
                else:
                    need(ns == 0xffffffff, "Unknown attribute namespace")
                    key = attr_name
                need(key not in node["attrs"], "Duplicate XML attribute")
                node["attrs"][key] = s(value) if value_type == 3 else value
            nodes.append(node)
            stack.append(node)
        elif kind == 0x103:
            need(stack and stack[-1]["name"] == s(u32(data, at + 20)), "Mismatched XML end node")
            stack.pop()
        elif kind not in (0x100, 0x101):
            raise ValueError("Unexpected manifest XML chunk: " + hex(kind))
        at += size
    need(not stack and at == len(data), "Incomplete manifest tree")
    root = next(node for node in nodes if node["parent"] is None)
    need(root["name"] == "manifest", "Manifest root missing")
    need(root["attrs"].get("package") == "com.subwayrunner.test2026", "Unexpected Android package")
    need(root["attrs"].get("android:versionCode") == 20, "Unexpected versionCode")
    sdk = next(node for node in nodes if node["name"] == "uses-sdk")
    need(sdk["attrs"].get("android:minSdkVersion") == 24 and sdk["attrs"].get("android:targetSdkVersion") == 36, "Unexpected min/target SDK")
    need(not any(node["name"].startswith("uses-permission") for node in nodes), "Offline demo unexpectedly requests permissions")
    application = next(node for node in nodes if node["name"] == "application")
    activity = next(node for node in nodes if node["name"] == "activity")
    need(bool(activity["attrs"].get("android:exported")), "Launcher activity is not exported")
    need(bool(activity["attrs"].get("android:hardwareAccelerated", application["attrs"].get("android:hardwareAccelerated", 0))), "WebGL requires hardware acceleration")
    need(activity["attrs"].get("android:screenOrientation") == 1, "Portrait orientation missing")
    filters = [node for node in nodes if node["name"] == "intent-filter" and node["parent"] is activity]
    need(any(any(n["parent"] is item and n["name"] == "action" and n["attrs"].get("android:name") == "android.intent.action.MAIN" for n in nodes) and any(n["parent"] is item and n["name"] == "category" and n["attrs"].get("android:name") == "android.intent.category.LAUNCHER" for n in nodes) for item in filters), "MAIN/LAUNCHER intent filter missing")
    activity_name = activity["attrs"]["android:name"]
    if activity_name.startswith("."):
        activity_name = root["attrs"]["package"] + activity_name
    elif "." not in activity_name:
        activity_name = root["attrs"]["package"] + "." + activity_name
    print("PASS: binary manifest chunks, Android attribute IDs, exported launcher and SDK settings")
    return "L" + activity_name.replace(".", "/") + ";"

def leb(data: bytes, at: int) -> tuple[int, int]:
    value = 0
    for shift in range(0, 35, 7):
        byte = data[at]
        at += 1
        value |= (byte & 0x7f) << shift
        if not byte & 0x80:
            return value, at
    raise ValueError("Overlong ULEB128")

def dex_file(data: bytes, launcher: str) -> None:
    need(data[:8] in (b"dex\n035\x00", b"dex\n037\x00", b"dex\n038\x00", b"dex\n039\x00"), "Unsupported DEX magic")
    need(u32(data, 32) == len(data) and u32(data, 36) == 112 and u32(data, 40) == 0x12345678, "Invalid DEX header")
    need(u32(data, 8) == zlib.adler32(data[12:]) & 0xffffffff, "DEX Adler32 mismatch")
    need(data[12:32] == hashlib.sha1(data[32:]).digest(), "DEX SHA1 mismatch")
    need(u32(data, 44) == 0 and u32(data, 48) == 0, "Unexpected DEX link section")
    counts = [u32(data, at) for at in range(56, 104, 8)]
    offsets = [u32(data, at) for at in range(60, 108, 8)]
    widths = [4, 4, 12, 8, 8, 32]
    for count, offset, width in zip(counts, offsets, widths):
        need((count == 0 and offset == 0) or (offset % 4 == 0 and offset >= 112 and offset + count * width <= len(data)), "DEX ID/class table extent/alignment invalid")
    string_count, type_count, proto_count, field_count, method_count, class_count = counts
    strings = []
    string_offsets = []
    for i in range(string_count):
        at = u32(data, offsets[0] + i * 4)
        string_offsets.append(at)
        utf16_length, at = leb(data, at)
        end = data.index(b"\0", at)
        text = data[at:end].decode("utf-8")
        need(len(text.encode("utf-16-le")) // 2 == utf16_length, "DEX string length mismatch")
        strings.append(text)
    need(strings == sorted(set(strings)), "DEX string IDs must be uniquely sorted")
    type_indexes = [u32(data, offsets[1] + i * 4) for i in range(type_count)]
    need(type_indexes == sorted(set(type_indexes)) and all(i < string_count for i in type_indexes), "DEX type IDs invalid or unsorted")
    types = [strings[i] for i in type_indexes]
    protos = []
    type_list_offsets = []
    for i in range(proto_count):
        shorty, return_type, params = struct.unpack_from("<III", data, offsets[2] + 12 * i)
        need(shorty < string_count and return_type < type_count, "DEX proto indexes out of range")
        arguments = []
        if params:
            need(params % 4 == 0 and params + 4 <= len(data), "DEX type-list alignment invalid")
            type_list_offsets.append(params)
            amount = u32(data, params)
            need(params + 4 + amount * 2 <= len(data), "DEX parameter list overruns file")
            arguments = list(struct.unpack_from("<" + "H" * amount, data, params + 4))
            need(all(t < type_count for t in arguments), "DEX parameter type out of range")
        def short_type(index: int) -> str:
            value = types[index]
            return "L" if value[0] in "[L" else value
        need(strings[shorty] == short_type(return_type) + "".join(short_type(a) for a in arguments), "DEX shorty descriptor mismatch")
        protos.append((return_type, tuple(arguments)))
    need(protos == sorted(set(protos)), "DEX proto IDs must be uniquely sorted")
    fields = [struct.unpack_from("<HHI", data, offsets[3] + i * 8) for i in range(field_count)]
    need(all(c < type_count and t < type_count and n < string_count for c, t, n in fields), "DEX field index invalid")
    need(fields == sorted(set(fields), key=lambda p: (p[0], p[2], p[1])), "DEX field IDs not uniquely sorted")
    methods = [struct.unpack_from("<HHI", data, offsets[4] + i * 8) for i in range(method_count)]
    need(all(c < type_count and p < proto_count and n < string_count for c, p, n in methods), "DEX method index invalid")
    need(methods == sorted(set(methods), key=lambda p: (p[0], p[2], p[1])), "DEX method IDs not uniquely sorted")
    classes = []
    class_data_offsets = []
    code_offsets = []
    definitions = {}
    for i in range(class_count):
        values = struct.unpack_from("<8I", data, offsets[5] + i * 32)
        cls, access, superclass, interfaces, source, annotations, class_data, static_values = values
        need(cls < type_count and superclass < type_count and class_data > 0, "DEX class definition invalid")
        need(not interfaces and not annotations and not static_values, "Unexpected minimal-APK DEX extensions")
        classes.append(cls)
        need(types[superclass] == "Landroid/app/Activity;", "Launcher must inherit framework Activity")
        class_data_offsets.append(class_data)
        at = class_data
        sizes = []
        for _ in range(4):
            value, at = leb(data, at)
            sizes.append(value)
        for amount in sizes[:2]:
            field_index = 0
            for _ in range(amount):
                diff, at = leb(data, at)
                flags, at = leb(data, at)
                field_index += diff
                need(field_index < field_count and fields[field_index][0] == cls, "Encoded field invalid")
        for amount in sizes[2:]:
            method_index = 0
            for _ in range(amount):
                diff, at = leb(data, at)
                flags, at = leb(data, at)
                code, at = leb(data, at)
                method_index += diff
                need(method_index < method_count and methods[method_index][0] == cls and code % 4 == 0, "Encoded method/code invalid")
                need(method_index not in definitions, "Duplicate method definition")
                definitions[method_index] = flags, code
                code_offsets.append(code)
    need(classes == sorted(set(classes)) and launcher in [types[c] for c in classes], "Manifest launcher missing from DEX")
    method_calls = {}
    for index, (flags, code) in definitions.items():
        regs, ins, outs, tries, debug, units = struct.unpack_from("<HHHHII", data, code)
        need(tries == 0 and debug == 0 and code + 16 + units * 2 <= len(data), "Unsupported/out-of-bounds minimal DEX code")
        cls, proto, name = methods[index]
        expected_ins = sum(2 if types[t] in ("D", "J") else 1 for t in protos[proto][1]) + (0 if flags & 8 else 1)
        need(ins == expected_ins and regs >= ins, "DEX incoming argument register count mismatch")
        words = list(struct.unpack_from("<" + "H" * units, data, code + 16))
        pc = 0
        calls = []
        max_out = 0
        while pc < len(words):
            first = words[pc]
            op = first & 255
            a = first >> 8
            if op in (0x0a, 0x0b, 0x0c, 0x0f, 0x10, 0x11):
                need(a < regs, "DEX result/return register out of bounds")
                width = 1
            elif op == 0x0e:
                need(protos[proto][0] == types.index("V"), "return-void used by nonvoid method")
                width = 1
            elif op == 0x12:
                need((a & 15) < regs, "DEX const/4 register out of bounds")
                width = 1
            elif op in (0x13, 0x15, 0x16, 0x19):
                need(a < regs, "DEX const register out of bounds")
                width = 2
            elif op in (0x14, 0x17):
                need(a < regs, "DEX const register out of bounds")
                width = 3
            elif op in (0x1a, 0x22):
                need(a < regs and words[pc + 1] < (string_count if op == 0x1a else type_count), "DEX string/type instruction index invalid")
                width = 2
            elif op in (0x6e, 0x6f, 0x70, 0x71, 0x72):
                count = first >> 12
                need(count <= 5 and words[pc + 1] < method_count, "DEX invoke count/index invalid")
                called = methods[words[pc + 1]]
                call_proto = protos[called[1]]
                needed = sum(2 if types[t] in ("D", "J") else 1 for t in call_proto[1]) + (0 if op == 0x71 else 1)
                need(count == needed, "DEX invoke argument arity mismatch")
                raw = words[pc + 2]
                registers = [(raw >> shift) & 15 for shift in (0, 4, 8, 12)] + [(first >> 8) & 15]
                need(all(r < regs for r in registers[:count]), "DEX invoke register out of bounds")
                calls.append((types[called[0]], strings[called[2]], tuple(types[t] for t in call_proto[1])))
                max_out = max(max_out, count)
                width = 3
            elif op in range(0x52, 0x60):
                need((a & 15) < regs and (a >> 4) < regs and words[pc + 1] < field_count, "DEX field instruction invalid")
                width = 2
            elif op in (0x01, 0x04, 0x07):
                need((a & 15) < regs and (a >> 4) < regs, "DEX move register invalid")
                width = 1
            elif op in (0x02, 0x05, 0x08):
                need(a < regs and words[pc + 1] < regs, "DEX move/from16 register invalid")
                width = 2
            elif op == 0:
                width = 1
            else:
                raise ValueError(f"Unhandled DEX opcode {op:#x}; extend independent decoder before accepting")
            need(pc + width <= len(words), "DEX instruction overruns code")
            pc += width
        need(words and words[-1] == 0x0e and max_out <= outs, "DEX method lacks return or outgoing register capacity")
        method_calls[strings[name]] = calls
    need("<init>" in method_calls and "onCreate" in method_calls, "Activity constructor/onCreate definitions missing")
    needed_calls = {("Landroid/app/Activity;", "onCreate"), ("Landroid/webkit/WebView;", "<init>"), ("Landroid/webkit/WebView;", "getSettings"), ("Landroid/webkit/WebSettings;", "setJavaScriptEnabled"), ("Landroid/webkit/WebSettings;", "setDomStorageEnabled"), ("Landroid/app/Activity;", "setContentView"), ("Landroid/webkit/WebView;", "loadUrl")}
    need(needed_calls.issubset({(cls, name) for cls, name, args in method_calls["onCreate"]}), "Launcher does not initialize complete WebView game")
    need("file:///android_asset/index.html" in strings, "Offline Android entry URL missing")
    map_offset = u32(data, 52)
    need(map_offset % 4 == 0 and map_offset + 4 <= len(data), "DEX map offset invalid")
    map_count = u32(data, map_offset)
    mapping = [struct.unpack_from("<HHII", data, map_offset + 4 + 12 * i) for i in range(map_count)]
    need(all(unused == 0 and size > 0 and offset < len(data) for kind, unused, size, offset in mapping), "DEX map record invalid")
    need([m[3] for m in mapping] == sorted(m[3] for m in mapping) and len({m[0] for m in mapping}) == len(mapping), "DEX map not ordered/unique")
    entries = {kind: (size, offset) for kind, unused, size, offset in mapping}
    need(entries.get(0) == (1, 0) and entries.get(0x1000) == (1, map_offset), "DEX map/header self-reference invalid")
    for kind, amount, offset in zip(range(1, 7), counts, offsets):
        if amount:
            need(entries.get(kind) == (amount, offset), "DEX map/header ID count mismatch")
    need(entries.get(0x2000) == (len(class_data_offsets), min(class_data_offsets)), "DEX class-data map mismatch")
    need(entries.get(0x2001) == (len(code_offsets), min(code_offsets)), "DEX code-item map mismatch")
    need(entries.get(0x2002) == (len(string_offsets), min(string_offsets)), "DEX string-data map mismatch")
    if type_list_offsets:
        need(entries.get(0x1001) == (len(set(type_list_offsets)), min(type_list_offsets)), "DEX type-list map mismatch")
    need(u32(data, 104) + u32(data, 108) == len(data) and u32(data, 108) % 4 == 0, "DEX data extent invalid")
    print(f"PASS: DEX checksums, sorted ID tables/prototypes, {len(definitions)} method bodies/registers and map extents")

def check(path: Path, run_java: bool = True) -> None:
    blob = path.read_bytes()
    certificate = apk_v2(blob)
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        need(len(names) == len(set(names)), "Duplicate ZIP paths")
        need(archive.testzip() is None, "Corrupt ZIP CRC")
        need(all(not name.startswith("/") and ".." not in Path(name).parts for name in names), "Unsafe ZIP path")
        required = {"AndroidManifest.xml", "classes.dex", "assets/index.html", "assets/app.js", "assets/style.css", "assets/simulation.js", "assets/renderer.js", "assets/assets/models.js"}
        need(required.issubset(names), "APK game payload missing: " + repr(sorted(required - set(names))))
        need(not any(name.endswith((".pem", ".keystore", ".jks", ".env")) for name in names), "Signing/credential material inside APK")
        for name in ["classes.dex", "resources.arsc"]:
            if name not in names:
                continue
            info = archive.getinfo(name)
            local = info.header_offset
            data_offset = local + 30 + u16(blob, local + 26) + u16(blob, local + 28)
            need(info.compress_type == zipfile.ZIP_STORED and data_offset % 4 == 0, "Store and 4-byte align " + name)
        html = archive.read("assets/index.html").decode()
        need(not any(url.startswith(("http:", "https:", "//")) for url in __import__("re").findall(r'(?:src|href)=[\"\']([^\"\']+)', html)), "Remote HTML dependency")
        apk_v1(archive, certificate)
        launcher = manifest_xml(archive.read("AndroidManifest.xml"))
        dex_file(archive.read("classes.dex"), launcher)
    if run_java:
        verifier = Path(__file__).with_name("VerifyLocalJar.java")
        verified = subprocess.run(["java", str(verifier), str(path)], capture_output=True, text=True)
        need(verified.returncode == 0, "JDK streaming verifier failed:\n" + verified.stdout + verified.stderr)
        print(verified.stdout.strip())
        jarsigner = subprocess.run(["java", "--module", "jdk.jartool/sun.security.tools.jarsigner.Main", "-verify", str(path)], capture_output=True, text=True)
        need(jarsigner.returncode == 0 and "jar verified" in jarsigner.stdout, "JDK jarsigner rejected APK:\n" + jarsigner.stdout + jarsigner.stderr)
        print("PASS: independent JDK jarsigner verification (self-signed app certificate expected)")
    print(f"PASS: complete offline game package ({len(blob):,} bytes), SHA256 {hashlib.sha256(blob).hexdigest()}")
    print("LIMIT: Android PackageManager/ART installation and phone WebView behavior are not tested here.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("apk", nargs="?", type=Path, default=Path(__file__).resolve().parents[1] / "release/Subway-Runner-test.apk")
    parser.add_argument("--skip-java", action="store_true")
    args = parser.parse_args()
    check(args.apk, not args.skip_java)
