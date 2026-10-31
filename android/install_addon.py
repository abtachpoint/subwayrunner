#!/usr/bin/env python3
"""Copy a compiled services AAR and v2 export scripts into the Godot project.

This does not build or pretend a missing AAR exists. Run once per built variant.
"""
from pathlib import Path
import argparse
import shutil

parser = argparse.ArgumentParser()
parser.add_argument("--variant", choices=("debug", "release"), default="debug")
parser.add_argument("--game", type=Path, default=Path(__file__).resolve().parent.parent / "game")
args = parser.parse_args()
root = Path(__file__).resolve().parent
aar = root / "services/build/outputs/aar" / f"services-{args.variant}.aar"
if not aar.is_file():
    raise SystemExit(f"Missing compiled AAR: {aar}; build :services:assemble{args.variant.title()} first.")
destination = args.game / "addons/subway_runner_services"
destination.mkdir(parents=True, exist_ok=True)
(destination / "bin").mkdir(exist_ok=True)
for file in (root / "export_scripts_template").iterdir():
    if file.is_file():
        shutil.copy2(file, destination / file.name)
shutil.copy2(aar, destination / "bin" / aar.name)
print(f"Installed {args.variant} services plugin into {destination}")
