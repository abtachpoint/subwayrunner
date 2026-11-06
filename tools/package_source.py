#!/usr/bin/env python3
"""Archive editable source without player data, binaries, caches or secrets."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib
import argparse
import json

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--output', default='release/Subway-Runner-consolidated-source.zip')
parser.add_argument('--flat', action='store_true', help='Put codemagic.yaml directly at the ZIP/repository root')
args = parser.parse_args()
target = root / args.output
target.parent.mkdir(exist_ok=True)
excluded = {".git", ".godot", ".runtime", ".signing", ".secrets", "release", "art-check", "__pycache__", ".gradle", "build", ".venv", "node_modules", ".wrangler", ".ci"}
allowed_suffixes = {".js", ".css", ".html", ".java", ".cjs", ".mjs", ".jsonc", ".rules", ".sh", ".yml", ".yaml", ".gd", ".godot", ".tscn", ".svg", ".gdshader", ".json", ".py", ".md", ".txt", ".kts", ".kt", ".xml", ".pro", ".properties", ".cfg", ".uid", ".ini"}
with ZipFile(target, "w", ZIP_DEFLATED, compresslevel=9) as archive:
    for file in sorted(root.rglob("*")):
        relative = file.relative_to(root)
        if not file.is_file() or any(part in excluded for part in relative.parts):
            continue
        if file.name in {'.env', '.dev.vars', 'local.properties'} or (file.name.startswith(('.env.', '.dev.vars.')) and not file.name.endswith('.example')):
            continue
        in_third_party = relative.parts[:2] == ('tools', 'third_party') and file.suffix in {'.glb', '.png'}  # CC0 source models used by tools/build_city_assets.py
        if file.name not in {".gitignore", ".env.example", ".dev.vars.example"} and file.suffix not in allowed_suffixes and not in_third_party:
            continue
        if file.suffix == '.json':
            try:
                parsed = json.loads(file.read_text())
            except (ValueError, UnicodeError):
                parsed = None
            if isinstance(parsed, dict) and any(k in parsed for k in ('private_key', 'client_secret', 'refresh_token')):
                raise SystemExit('Refusing to archive a credential JSON file: ' + str(relative))
        archive.write(file, ("" if args.flat else "Subway-Runner/") + str(relative))
print(f"Created {target} ({target.stat().st_size:,} bytes)")
print("SHA256 " + hashlib.sha256(target.read_bytes()).hexdigest())
