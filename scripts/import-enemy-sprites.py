#!/usr/bin/env python3
"""
Import enemy sprites as 128x128 atlases and wire them into the manifest.

Usage:
  python3 scripts/import-enemy-sprites.py /path/to/downloaded/pngs

- Sorts the source PNGs by creation time (ctime) to match the desired order
- Renames to the expected ids from content/enemies/core-enemies.json
- Resizes to 128x128 using nearest-neighbor (pixel crisp)
- Saves to assets/generated/pixel/atlas/<enemy_id>.png
- Creates TexturePacker-like single-frame meta in assets/generated/pixel/meta/<enemy_id>.json
- Updates assets/generated/pixel/manifest.json with atlas + combatant bindings

Requires: Pillow (pip install Pillow)
"""
from __future__ import annotations
import json
import os
import sys
from pathlib import Path

try:
    from PIL import Image
except Exception as exc:  # pragma: no cover
    print("[import-enemy-sprites] Pillow not found. Install with: pip install Pillow")
    raise

ROOT = Path(__file__).resolve().parent.parent
ASSETS_ROOT = ROOT / 'assets' / 'generated' / 'pixel'
ATLAS_DIR = ASSETS_ROOT / 'atlas'
META_DIR = ASSETS_ROOT / 'meta'
MANIFEST_PATH = ASSETS_ROOT / 'manifest.json'
ENEMIES_JSON = ROOT / 'content' / 'enemies' / 'core-enemies.json'
SIZE = 128

ORDERED_IDS = [
    'saqueador_rio',
    'besta_do_cipo',
    'atirador_fantasma',
    'bruxo_gramofone',
    'capataz_alfandega',
    'sentinela_nevoa',
    'jaguar_lunar',
    'capitao_vesper',
    'capanga_vesper',
]

STYLE_BY_TAG = {
    'machine': 'guardian',
    'construct': 'guardian',
    'cult': 'spitter',
    'beast': 'stalker',
}


def style_for_tags(tags: list[str]) -> str:
    for tag in tags:
        if tag in STYLE_BY_TAG:
            return STYLE_BY_TAG[tag]
    return 'stalker'


def load_enemies_index() -> dict[str, dict]:
    data = json.loads(ENEMIES_JSON.read_text('utf-8'))
    index = {entry['id']: entry for entry in data if isinstance(entry, dict) and 'id' in entry}
    return index


def read_manifest() -> dict:
    if MANIFEST_PATH.exists():
        return json.loads(MANIFEST_PATH.read_text('utf-8'))
    return {
        'version': 1,
        'generatedAt': '1970-01-01T00:00:00.000Z',
        'atlases': [],
        'combatants': [],
        'uiIcons': [],
        'diceFaces': [],
        'biomeThemes': [],
    }


def ensure_dirs() -> None:
    ATLAS_DIR.mkdir(parents=True, exist_ok=True)
    META_DIR.mkdir(parents=True, exist_ok=True)


def sort_pngs_by_ctime(src: Path) -> list[Path]:
    files = [p for p in src.iterdir() if p.is_file() and p.suffix.lower() == '.png']
    files.sort(key=lambda p: p.stat().st_ctime)
    return files


def upsert_atlas(manifest: dict, atlas_id: str, rel_path: str, width: int, height: int) -> None:
    atlases: list = manifest.get('atlases', [])
    for entry in atlases:
        if isinstance(entry, dict) and entry.get('id') == atlas_id:
            entry['path'] = rel_path
            entry['width'] = width
            entry['height'] = height
            entry['domain'] = 'combat'
            return
    atlases.append({
        'id': atlas_id,
        'path': rel_path,
        'width': width,
        'height': height,
        'domain': 'combat',
    })
    manifest['atlases'] = atlases


def upsert_combatant_binding(manifest: dict, visual_key: str, atlas_id: str, meta_rel: str, style: str) -> None:
    combatants: list = manifest.get('combatants', [])
    for entry in combatants:
        if isinstance(entry, dict) and entry.get('visualKey') == visual_key:
            # Keep any non-procedural binding; update fields for texturepacker binding
            entry.update({
                'visualKey': visual_key,
                'source': 'texturepacker',
                'atlasId': atlas_id,
                'metaPath': meta_rel,
                'width': SIZE,
                'height': SIZE,
                'anchorX': 0.5,
                'anchorY': 1,
                'style': style,
            })
            manifest['combatants'] = combatants
            return
    combatants.append({
        'visualKey': visual_key,
        'source': 'texturepacker',
        'atlasId': atlas_id,
        'metaPath': meta_rel,
        'width': SIZE,
        'height': SIZE,
        'anchorX': 0.5,
        'anchorY': 1,
        'style': style,
    })
    manifest['combatants'] = combatants


def write_meta(meta_path: Path) -> None:
    meta = {
        'frames': {
            'idle_0.png': {
                'frame': { 'x': 0, 'y': 0, 'w': SIZE, 'h': SIZE },
                'duration': 200,
            }
        }
    }
    meta_path.write_text(json.dumps(meta, indent=2) + '\n', encoding='utf-8')


def process_images(src_dir: Path) -> None:
    ensure_dirs()
    enemies_index = load_enemies_index()
    manifest = read_manifest()

    sources = sort_pngs_by_ctime(src_dir)
    if len(sources) < len(ORDERED_IDS):
        print(f"[import-enemy-sprites] Aviso: {len(sources)} arquivos encontrados; {len(ORDERED_IDS)} exigidos.")

    for i, enemy_id in enumerate(ORDERED_IDS):
        if i >= len(sources):
            print(f"[import-enemy-sprites] Faltando imagem para {enemy_id}; ignorando.")
            continue

        src_path = sources[i]
        out_png = ATLAS_DIR / f"{enemy_id}.png"
        out_meta = META_DIR / f"{enemy_id}.json"
        atlas_id = f"enemy.{enemy_id}"
        rel_png = f"atlas/{enemy_id}.png"
        rel_meta = f"meta/{enemy_id}.json"

        # Load → convert → resize → save (nearest)
        img = Image.open(src_path).convert('RGBA')
        img = img.resize((SIZE, SIZE), resample=Image.NEAREST)
        img.save(out_png)

        write_meta(out_meta)

        tags = enemies_index.get(enemy_id, {}).get('tags', [])
        style = style_for_tags(tags)

        upsert_atlas(manifest, atlas_id, rel_png, SIZE, SIZE)
        upsert_combatant_binding(manifest, f"enemy:{enemy_id}", atlas_id, rel_meta, style)

        print(f"[import-enemy-sprites] OK: {src_path.name} → {rel_png} (visualKey=enemy:{enemy_id})")

    manifest['generatedAt'] = manifest.get('generatedAt') or '1970-01-01T00:00:00.000Z'
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f"[import-enemy-sprites] Manifest atualizado em {MANIFEST_PATH.relative_to(ROOT)}")


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Uso: python3 scripts/import-enemy-sprites.py /caminho/para/pngs")
        sys.exit(2)
    src_dir = Path(sys.argv[1]).expanduser().resolve()
    if not src_dir.exists():
        print(f"Diretorio nao encontrado: {src_dir}")
        sys.exit(2)
    process_images(src_dir)
