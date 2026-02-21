# Pixel Art Bible (Official)

## 1. Base Style
- Full pixel art.
- No blur.
- No anti-aliasing.
- Pixel-perfect edges.
- 2-3 solid shading steps per material.
- External outline darker than base tone.
- High contrast for mobile vertical readability.

## 2. Character Format
- Aspect ratio: 1:1.
- Base resolution: 128x128.
- Character occupancy: 70-80% of frame.
- Centered subject.
- Flat dark background.
- Light source: top-left.
- Simplified shadows, no soft gradients.
- Silhouette must remain readable at 50% zoom.

## 3. Class Palettes
- Per character color budget: 8-14 colors.

### aviadora
- Leather red: `#A63A3A`
- Mustard yellow: `#D4A437`
- Dark brown: `#4A2E1F`
- Warm skin beige
- Deep sky blue accents
- Soft black outline
- Mood: warm, vibrant, adventurous

### ocultista
- Deep purple: `#3B2C5E`
- Dark emerald: `#1F5E4E`
- Petroleum blue
- Cool beige
- Coal gray
- Deep black
- Mood: mysterious, ritualistic

### cacador
- Jungle green: `#2F5D3A`
- Earth brown: `#5C3A21`
- Sand beige
- Steel gray
- Dark shadow green
- Soft black
- Mood: natural, rustic, focused

### mecanico
- Copper: `#B87333`
- Navy blue: `#1F2E4A`
- Metal gray: `#6E6E6E`
- Leather brown
- Rust yellow
- Soft black
- Mood: industrial, inventive

## 4. Emotional States (Standard)
- `neutro`: confident expression, normal eyes, standard lighting.
- `ferido`: subtle dirt/cut, heavier shadows, restrained dark-red accent.
- `buffado`: brighter eyes, lighter inner contour, tiny pixel spark, +5-10% saturation.
- `amaldicoado`: green/purple under-eye shade, hollow/semi-closed eyes, subtle supernatural glow, slight desaturation.

Rule: avoid gore exaggeration (light cartoony pulp tone).

## 5. Enemy Style Guide
- Recognizable silhouette in <= 1 second.
- 10-12 colors per enemy.
- Slightly higher contrast than party characters.
- Pulp cover feeling with controlled exaggeration.

### Enemy dimensions
- Common: `96x96` or `128x128`.
- Elite: `128x128` fixed.
- Boss: `192x192` or `256x256`.

### Enemy default animation set
- `idle` (2-frame bounce)
- `attack` windup
- `hit` flash
- `die` simple fade/fall

## 6. Dice Visual Guide
- Dice base: `48x48` or `64x64`.
- Thick outer outline.
- Pixel-rounded corners.
- Light source top-left.
- Icon readability target: `16x16`.
- Max icon colors: 3.

### Rarity colors
- Common: ivory/beige base.
- Rare: deep blue.
- Epic: vibrant purple.
- Relic: golden with subtle highlight.

### Dice animation timing
- Roll: `120-180ms`.
- Settle: `80ms`.
- Final bounce: `1px`.
- Crit: 1 white flash frame + 2 tiny particles.

## 7. UI Retro Art Deco (Mobile Vertical)
- Top: resources + pause.
- Center: map/combat stage.
- Bottom: large readable dice tray.
- Geometric deco frames and 45-degree corners.
- Thin golden lines and symmetry.

### UI base colors
- Background: `#141414`
- Panel: `#1E1E1E`
- Gold accent: `#C9A227`
- Main text: off-white

### Button states
- `normal`
- `pressed` (Y -1px)
- `disabled` (desaturated)
- `selected` (gold outline)

## 8. Narrative Event Visual Guide
- Event screen should resemble a folded pulp magazine page.
- Header: poster-like title.
- Center: pixel mini-scene (`128x64`).
- Body text: short (3-5 lines).
- Choices: large buttons + clear icons.
- Event illustration: single focus, 6-10 colors, optional light dithering.

## 9. Asset Pipeline (Aseprite + Voxelyn)
- Canvas: `128x128` for party busts.
- Indexed mode palette lock.
- Dedicated outline layer.
- PNG export without blur.
- Atlas padding: `2px`.
- Grid: `128x128`.

### Naming
- Raw party file: `classe_background_estado.aseprite`
- Frame export: `estado_clip_indice.png`
- Supported states: `neutro`, `ferido`, `buffado`, `amaldicoado`
- Supported clips: `idle`, `walk`, `attack`, `cast`, `hit`, `die`

## 10. Runtime Rules
- Integer scaling whenever possible.
- `imageSmoothingEnabled = false` in canvas paths.
- `image-rendering: pixelated` for scaled sprite images.
- No fractional transform rules that blur pixels.

## 11. Manifest Conventions
- `combatants[*].supportedStates`
- `combatants[*].defaultState = "neutro"`
- `combatants[*].framePattern = "state_clip_index"`
- `combatants[*].width/height = 128`
- `combatants[*].anchorX/anchorY = 0.5 / 1`

## 12. Acceptance Intent
- Visual identity consistency.
- Scalable content pipeline.
- Production-ready integration for combat-first MVP.
