# Pixel Revamp Spec (MVP)

## Objective
- Deliver a crisp pixel-art mobile vertical UI with pulp + Art Deco visual language.
- Keep DOM-first rendering and integrate combatant clips through `@voxelyn/animation`.

## Non-negotiables
- Disable canvas smoothing when scaling pixel art.
- Keep integer-like scaling behavior where possible.
- Avoid vector text as die-face icon art.

## Layout rules (vertical)
- Top strip: run/combat status and controls.
- Middle: combat stage with explicit target slots and readable silhouettes.
- Bottom: dice tray and short log.

## Art direction
- Dark navy paper base + warm brass highlights.
- Geometric Art Deco borders in frames and cards.
- Pulp accents in danger and reward states.

## Technical rules
- Atlas cap: 2048x2048 each.
- Estimated atlas budget: <= 40MB RGBA8.
- Fallback mandatory:
  - Missing combatant clip => procedural character.
  - Missing die icon => fallback icon glyph.

## Naming convention
- `assets/raw/aseprite/combat/party/<visual_key>.aseprite`
- `assets/raw/aseprite/combat/enemies/<visual_key>.aseprite`
- `assets/raw/aseprite/ui/dice_faces/<icon_id>.aseprite`
- `assets/raw/aseprite/ui/icons/<icon_id>.aseprite`

## Required clip tags
- `idle`, `walk`, `attack`, `cast`, `hit`, `die`

## Anchors
- Default anchor: `(0.5, 1.0)`
- Ground point must align consistently across party and enemies.

## QA checklist
- Typecheck and build pass.
- `assets:build` and `assets:check` pass.
- No blur on dice, miniatures, and slot art at DPR 1 and DPR 3.
