#!/usr/bin/env python3
"""Build the offline WebView test package using local Python cryptography.

This encodes actual Android binary XML and DEX, not a renamed browser archive.
The Android platform is still required to establish installation/runtime behavior.
No private signing material is copied into the APK or source archive.
"""
from __future__ import annotations
import argparse
import base64
import datetime
import hashlib
import io
import os
from pathlib import Path
import struct
import zlib
import zipfile
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.serialization import pkcs7
from cryptography.x509.oid import NameOID

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = 'com.subwayrunner.test2026'
ACTIVITY = PACKAGE + '.MainActivity'
NO_INDEX = 0xffffffff
U16 = lambda value: struct.pack('<H', value)
U32 = lambda value: struct.pack('<I', value)
U64 = lambda value: struct.pack('<Q', value)
LP = lambda value: U32(len(value)) + value


def align(blob: bytearray, boundary: int = 4) -> None:
    blob.extend(b'\0' * ((-len(blob)) % boundary))


def uleb(value: int) -> bytes:
    result = bytearray()
    while True:
        part = value & 127
        value >>= 7
        result.append(part | (128 if value else 0))
        if not value:
            return bytes(result)


def dex_file() -> bytes:
    own = 'L' + ACTIVITY.replace('.', '/') + ';'
    activity, context, bundle = 'Landroid/app/Activity;', 'Landroid/content/Context;', 'Landroid/os/Bundle;'
    view, settings, webview = 'Landroid/view/View;', 'Landroid/webkit/WebSettings;', 'Landroid/webkit/WebView;'
    string = 'Ljava/lang/String;'
    # owner, name, return descriptor, parameter descriptors
    methods = [
        (activity, '<init>', 'V', ()), (activity, 'onCreate', 'V', (bundle,)),
        (activity, 'setContentView', 'V', (view,)),
        (webview, '<init>', 'V', (context,)),
        (webview, 'getSettings', settings, ()), (webview, 'loadUrl', 'V', (string,)),
        (settings, 'setJavaScriptEnabled', 'V', ('Z',)),
        (settings, 'setDomStorageEnabled', 'V', ('Z',)),
        (settings, 'setAllowFileAccess', 'V', ('Z',)),
        (settings, 'setAllowContentAccess', 'V', ('Z',)),
        (own, '<init>', 'V', ()), (own, 'onCreate', 'V', (bundle,)),
    ]
    descriptors = sorted({m[0] for m in methods} | {m[2] for m in methods} | {p for m in methods for p in m[3]})
    def shorty(ret: str, params: tuple) -> str:
        return ''.join('L' if d[0] in 'L[' else d for d in (ret,) + params)
    strings = sorted(set(descriptors) | {m[1] for m in methods} |
                     {shorty(m[2], m[3]) for m in methods} |
                     {'file:///android_asset/index.html'})
    sid = {s: i for i, s in enumerate(strings)}
    descriptors.sort(key=sid.__getitem__)
    tid = {s: i for i, s in enumerate(descriptors)}
    protos = sorted({(m[2], m[3]) for m in methods}, key=lambda p: (tid[p[0]], tuple(tid[x] for x in p[1])))
    pid = {p: i for i, p in enumerate(protos)}
    methods.sort(key=lambda m: (tid[m[0]], sid[m[1]], pid[(m[2], m[3])]))
    mid = {m: i for i, m in enumerate(methods)}
    def mi(owner: str, name: str, ret: str, params: tuple = ()) -> int:
        return mid[(owner, name, ret, params)]
    string_off = 112
    type_off = string_off + 4 * len(strings)
    proto_off = type_off + 4 * len(descriptors)
    method_off = proto_off + 12 * len(protos)
    class_off = method_off + 8 * len(methods)
    data_off = class_off + 32
    blob = bytearray(data_off)
    string_data_off = len(blob)
    string_offsets = []
    for value in strings:
        string_offsets.append(len(blob))
        blob.extend(uleb(len(value)) + value.encode('utf-8') + b'\0')
    align(blob)
    tuple_offsets = {}
    parameter_tuples = sorted({p[1] for p in protos if p[1]}, key=lambda p: tuple(tid[x] for x in p))
    type_list_off = len(blob)
    for params in parameter_tuples:
        align(blob)
        tuple_offsets[params] = len(blob)
        blob.extend(U32(len(params)) + b''.join(U16(tid[d]) for d in params))
        align(blob)
    def invoke(op: int, index: int, regs: list[int]) -> list[int]:
        assert len(regs) <= 5 and all(0 <= x < 16 for x in regs)
        padded = regs + [0] * (5 - len(regs))
        return [op | (len(regs) << 12) | (padded[4] << 8), index,
                padded[0] | (padded[1] << 4) | (padded[2] << 8) | (padded[3] << 12)]
    ctor = invoke(0x70, mi(activity, '<init>', 'V'), [0]) + [0x000e]
    code = invoke(0x6f, mi(activity, 'onCreate', 'V', (bundle,)), [4, 5])
    code += [0x0022, tid[webview]]
    code += invoke(0x70, mi(webview, '<init>', 'V', (context,)), [0, 4])
    code += invoke(0x6e, mi(webview, 'getSettings', settings), [0]) + [0x010c]
    code += [0x1212]
    code += invoke(0x6e, mi(settings, 'setJavaScriptEnabled', 'V', ('Z',)), [1, 2])
    code += invoke(0x6e, mi(settings, 'setDomStorageEnabled', 'V', ('Z',)), [1, 2])
    code += [0x0212]
    code += invoke(0x6e, mi(settings, 'setAllowFileAccess', 'V', ('Z',)), [1, 2])
    code += invoke(0x6e, mi(settings, 'setAllowContentAccess', 'V', ('Z',)), [1, 2])
    code += invoke(0x6e, mi(activity, 'setContentView', 'V', (view,)), [4, 0])
    code += [0x021a, sid['file:///android_asset/index.html']]
    code += invoke(0x6e, mi(webview, 'loadUrl', 'V', (string,)), [0, 2]) + [0x000e]
    align(blob)
    code_off = len(blob)
    ctor_off = len(blob)
    blob.extend(struct.pack('<HHHHII', 1, 1, 1, 0, 0, len(ctor)) + b''.join(U16(x) for x in ctor))
    align(blob)
    oncreate_off = len(blob)
    blob.extend(struct.pack('<HHHHII', 6, 2, 2, 0, 0, len(code)) + b''.join(U16(x) for x in code))
    class_data_off = len(blob)
    blob.extend(uleb(0) + uleb(0) + uleb(1) + uleb(1))
    blob.extend(uleb(mi(own, '<init>', 'V')) + uleb(0x10001) + uleb(ctor_off))
    blob.extend(uleb(mi(own, 'onCreate', 'V', (bundle,))) + uleb(0x4) + uleb(oncreate_off))
    align(blob)
    map_off = len(blob)
    maps = [(0x0000, 1, 0), (0x0001, len(strings), string_off),
            (0x0002, len(descriptors), type_off), (0x0003, len(protos), proto_off),
            (0x0005, len(methods), method_off), (0x0006, 1, class_off),
            (0x2002, len(strings), string_data_off), (0x1001, len(parameter_tuples), type_list_off),
            (0x2001, 2, code_off), (0x2000, 1, class_data_off), (0x1000, 1, map_off)]
    maps.sort(key=lambda m: m[2])
    blob.extend(U32(len(maps)))
    for kind, count, offset in maps:
        blob.extend(struct.pack('<HHII', kind, 0, count, offset))
    for i, offset in enumerate(string_offsets):
        struct.pack_into('<I', blob, string_off + i * 4, offset)
    for i, desc in enumerate(descriptors):
        struct.pack_into('<I', blob, type_off + i * 4, sid[desc])
    for i, (ret, params) in enumerate(protos):
        struct.pack_into('<III', blob, proto_off + i * 12, sid[shorty(ret, params)], tid[ret], tuple_offsets.get(params, 0))
    for i, (owner, name, ret, params) in enumerate(methods):
        struct.pack_into('<HHI', blob, method_off + i * 8, tid[owner], pid[(ret, params)], sid[name])
    struct.pack_into('<IIIIIIII', blob, class_off, tid[own], 1, tid[activity], 0, NO_INDEX, 0, class_data_off, 0)
    blob[:8] = b'dex\n035\0'
    struct.pack_into('<20I', blob, 32, len(blob), 112, 0x12345678, 0, 0, map_off,
                     len(strings), string_off, len(descriptors), type_off,
                     len(protos), proto_off, 0, 0, len(methods), method_off,
                     1, class_off, len(blob) - data_off, data_off)
    blob[12:32] = hashlib.sha1(blob[32:]).digest()
    struct.pack_into('<I', blob, 8, zlib.adler32(blob[12:]) & 0xffffffff)
    return bytes(blob)


def binary_manifest() -> bytes:
    android_uri = 'http://schemas.android.com/apk/res/android'
    attrs = {'theme': 0x01010000, 'label': 0x01010001, 'name': 0x01010003,
             'debuggable': 0x0101000f, 'exported': 0x01010010,
             'screenOrientation': 0x0101001e, 'configChanges': 0x0101001f,
             'minSdkVersion': 0x0101020c, 'versionCode': 0x0101021b,
             'versionName': 0x0101021c, 'targetSdkVersion': 0x01010270,
             'allowBackup': 0x01010280, 'hardwareAccelerated': 0x010102d3}
    strings = list(attrs) + ['android', android_uri, 'manifest', 'package', PACKAGE, 'uses-sdk',
          'application', 'Subway Runner', 'activity', ACTIVITY, 'intent-filter', 'action', 'category',
          'android.intent.action.MAIN', 'android.intent.category.LAUNCHER', '0.2.0-local-test']
    strings = list(dict.fromkeys(strings))
    ids = {s: i for i, s in enumerate(strings)}
    offsets, pool = [], bytearray()
    def strlen(n: int) -> bytes:
        if n < 128: return bytes([n])
        assert n < 32768
        return bytes([(n >> 8) | 0x80, n & 255])
    for value in strings:
        offsets.append(len(pool))
        encoded = value.encode('utf8')
        pool.extend(strlen(len(value)) + strlen(len(encoded)) + encoded + b'\0')
    align(pool)
    string_pool = struct.pack('<HHIIIIII', 1, 28, 28 + 4 * len(strings) + len(pool), len(strings), 0, 0x100, 28 + 4 * len(strings), 0)
    string_pool += b''.join(U32(x) for x in offsets) + pool
    resource_map = struct.pack('<HHI', 0x0180, 8, 8 + len(attrs) * 4) + b''.join(U32(attrs[s]) for s in strings[:len(attrs)])
    def node_header(kind: int, size: int) -> bytes:
        return struct.pack('<HHIII', kind, 16, size, 1, NO_INDEX)
    namespace = node_header(0x0100, 24) + U32(ids['android']) + U32(ids[android_uri])
    end_namespace = node_header(0x0101, 24) + U32(ids['android']) + U32(ids[android_uri])
    def start(tag: str, attributes: list[tuple]) -> bytes:
        # Attribute names with Android resource IDs are sorted by resource ID.
        attributes = sorted(attributes, key=lambda a: attrs.get(a[0], 0))
        result = node_header(0x0102, 36 + 20 * len(attributes))
        result += struct.pack('<IIHHHHHH', NO_INDEX, ids[tag], 20, 20, len(attributes), 0, 0, 0)
        for name, kind, value in attributes:
            ns = ids[android_uri] if name in attrs else NO_INDEX
            raw = ids[value] if kind == 3 else NO_INDEX
            data = ids[value] if kind == 3 else value
            result += struct.pack('<IIIHBBI', ns, ids[name], raw, 8, 0, kind, data)
        return result
    def end(tag: str) -> bytes:
        return node_header(0x0103, 24) + U32(NO_INDEX) + U32(ids[tag])
    result = namespace
    result += start('manifest', [('package', 3, PACKAGE), ('versionCode', 0x10, 20), ('versionName', 3, '0.2.0-local-test')])
    result += start('uses-sdk', [('minSdkVersion', 0x10, 24), ('targetSdkVersion', 0x10, 36)]) + end('uses-sdk')
    result += start('application', [('label', 3, 'Subway Runner'), ('theme', 1, 0x01030007), ('debuggable', 0x12, 0xffffffff),
                                   ('hardwareAccelerated', 0x12, 0xffffffff), ('allowBackup', 0x12, 0)])
    result += start('activity', [('name', 3, ACTIVITY), ('exported', 0x12, 0xffffffff), ('screenOrientation', 0x10, 1),
                                ('configChanges', 0x11, 0x00000fb0)])
    result += start('intent-filter', [])
    result += start('action', [('name', 3, 'android.intent.action.MAIN')]) + end('action')
    result += start('category', [('name', 3, 'android.intent.category.LAUNCHER')]) + end('category')
    result += end('intent-filter') + end('activity') + end('application') + end('manifest') + end_namespace
    return struct.pack('<HHI', 3, 8, 8 + len(string_pool) + len(resource_map) + len(result)) + string_pool + resource_map + result


def signing_identity():
    folder = ROOT / '.signing'
    folder.mkdir(mode=0o700, exist_ok=True)
    keyfile, certfile = folder / 'LOCAL-TEST-key.pem', folder / 'LOCAL-TEST-certificate.pem'
    if keyfile.exists():
        key = serialization.load_pem_private_key(keyfile.read_bytes(), password=None)
        cert = x509.load_pem_x509_certificate(certfile.read_bytes())
        assert key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo) == cert.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
        return key, cert
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Subway Runner Local Test')])
    cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(datetime.datetime(2020, 1, 1, tzinfo=datetime.timezone.utc))
            .not_valid_after(datetime.datetime(2050, 1, 1, tzinfo=datetime.timezone.utc)).sign(key, hashes.SHA256()))
    keyfile.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    os.chmod(keyfile, 0o600)
    certfile.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return key, cert


def jar_sign(payload: dict[str, bytes], key, cert) -> dict[str, bytes]:
    digest = lambda data: base64.b64encode(hashlib.sha256(data).digest()).decode('ascii')
    def header(name: str, value: str) -> bytes:
        # JAR headers have a 72-byte physical line limit. Continuation lines
        # start with one space, so they contain at most 71 further bytes.
        raw = f'{name}: {value}'.encode('utf8')
        lines = [raw[:72]]
        raw = raw[72:]
        while raw:
            lines.append(b' ' + raw[:71])
            raw = raw[71:]
        return b'\r\n'.join(lines) + b'\r\n'
    main = header('Manifest-Version', '1.0') + header('Created-By', 'Subway Runner offline builder') + b'\r\n'
    sections = {name: header('Name', name) + header('SHA-256-Digest', digest(data)) + b'\r\n' for name, data in payload.items()}
    manifest = main + b''.join(sections.values())
    sf = (header('Signature-Version', '1.0') + header('Created-By', 'Subway Runner offline builder') +
          header('SHA-256-Digest-Manifest', digest(manifest)) +
          header('SHA-256-Digest-Manifest-Main-Attributes', digest(main)) +
          header('X-Android-APK-Signed', '2') + b'\r\n')
    sf += b''.join(header('Name', name) + header('SHA-256-Digest', digest(section)) + b'\r\n' for name, section in sections.items())
    cms = (pkcs7.PKCS7SignatureBuilder().set_data(sf).add_signer(cert, key, hashes.SHA256())
           .sign(serialization.Encoding.DER, [pkcs7.PKCS7Options.DetachedSignature, pkcs7.PKCS7Options.Binary]))
    return {'META-INF/MANIFEST.MF': manifest, 'META-INF/SUBWAY.SF': sf, 'META-INF/SUBWAY.RSA': cms}


def unsigned_zip(entries: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', allowZip64=False) as archive:
        for name, data in entries.items():
            info = zipfile.ZipInfo(name, (2026, 10, 30, 0, 0, 0))
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_STORED if name in ['classes.dex', 'resources.arsc'] else zipfile.ZIP_DEFLATED
            if info.compress_type == zipfile.ZIP_STORED:
                start = buffer.tell() + 30 + len(name.encode('utf8'))
                pad = (-start) % 4
                if pad:
                    info.extra = struct.pack('<HH', 0xd935, pad) + b'\0' * pad
            archive.writestr(info, data, compresslevel=9)
    return buffer.getvalue()


def apk_v2_sign(unsigned: bytes, key, cert) -> bytes:
    end = unsigned.rfind(b'PK\x05\x06')
    assert end >= 0 and struct.unpack_from('<H', unsigned, end + 20)[0] == 0
    central_offset = struct.unpack_from('<I', unsigned, end + 16)[0]
    before, central, eocd = unsigned[:central_offset], unsigned[central_offset:end], unsigned[end:]
    chunk_hashes = []
    for region in [before, central, eocd]:
        for offset in range(0, len(region), 1024 * 1024):
            chunk = region[offset:offset + 1024 * 1024]
            chunk_hashes.append(hashlib.sha256(b'\xa5' + U32(len(chunk)) + chunk).digest())
    content_digest = hashlib.sha256(b'\x5a' + U32(len(chunk_hashes)) + b''.join(chunk_hashes)).digest()
    algorithm = 0x0103
    signed_data = LP(LP(U32(algorithm) + LP(content_digest))) + LP(LP(cert.public_bytes(serialization.Encoding.DER))) + LP(b'')
    signature = key.sign(signed_data, padding.PKCS1v15(), hashes.SHA256())
    signer = LP(signed_data) + LP(LP(U32(algorithm) + LP(signature))) + LP(key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo))
    # Top-level signers sequence, then its one length-prefixed signer.
    value = LP(LP(signer))
    pair = U64(4 + len(value)) + U32(0x7109871a) + value
    block_size = len(pair) + 24
    block = U64(block_size) + pair + U64(block_size) + b'APK Sig Block 42'
    fixed = bytearray(eocd)
    struct.pack_into('<I', fixed, 16, central_offset + len(block))
    return before + block + central + fixed


def build(allow_incomplete: bool = False) -> Path:
    web = ROOT / 'web'
    required = ['index.html', 'app.js', 'style.css', 'simulation.js', 'renderer.js', 'assets/models.js']
    absent = [name for name in required if not (web / name).is_file()]
    if absent and not allow_incomplete:
        raise SystemExit('Missing game asset(s): ' + ', '.join(absent))
    payload = {'AndroidManifest.xml': binary_manifest(), 'classes.dex': dex_file()}
    for source in sorted(web.rglob('*')):
        if source.is_file() and source.suffix in {'.html', '.js', '.css', '.json', '.png', '.svg', '.jpg', '.woff2'}:
            payload['assets/' + str(source.relative_to(web))] = source.read_bytes()
    key, cert = signing_identity()
    signed = apk_v2_sign(unsigned_zip({**jar_sign(payload, key, cert), **payload}), key, cert)
    output = ROOT / 'release/Subway-Runner-test.apk'
    output.parent.mkdir(exist_ok=True)
    output.write_bytes(signed)
    with zipfile.ZipFile(output) as archive:
        assert archive.testzip() is None
        assert archive.namelist()[:3] == ['META-INF/MANIFEST.MF', 'META-INF/SUBWAY.SF', 'META-INF/SUBWAY.RSA']
        dex = archive.read('classes.dex')
        assert dex[:8] == b'dex\n035\0'
        assert struct.unpack_from('<I', dex, 8)[0] == zlib.adler32(dex[12:]) & 0xffffffff
        assert dex[12:32] == hashlib.sha1(dex[32:]).digest()
        info = archive.getinfo('classes.dex')
        name_length, extra_length = struct.unpack_from('<HH', signed, info.header_offset + 26)
        assert (info.header_offset + 30 + name_length + extra_length) % 4 == 0
    print(f'Built {output}: {len(signed):,} bytes; actual Android AXML + DEX, offline WebView, v1 + v2 signed.')
    if absent:
        print('STRUCTURAL CHECK ONLY — missing assets: ' + ', '.join(absent))
    print('Device installation and Android WebView execution are not established by these local checks.')
    return output

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--allow-incomplete', action='store_true', help='Binary audit package only; never deliver an incomplete game.')
    build(parser.parse_args().allow_incomplete)
