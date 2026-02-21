# Pixel QA Checklist (DPR 1 + DPR 3)

## Build Gates
- [ ] `npm run assets:build`
- [ ] `npm run assets:check`
- [ ] `npm run typecheck`
- [ ] `npm run build`

## Pixel Crisp Validation
- [ ] No blur in combatant canvases.
- [ ] No blur in map miniatures.
- [ ] No blur in dice face sprites.
- [ ] No anti-aliased artifacts on scaled atlas sprites.
- [ ] No fractional scaling artifacts in key UI surfaces.

## Combatant Visual States
- [ ] Party entities resolve `neutro`.
- [ ] `ferido` triggers at HP ratio `<= 0.35`.
- [ ] `buffado` triggers with positive statuses.
- [ ] `amaldicoado` triggers with strong negative statuses (`stun/fear/poison/bleed`).
- [ ] Precedence works: `amaldicoado > buffado > ferido > neutro`.
- [ ] Missing state frames fallback to `neutro` or legacy frames without crash.

## Pipeline and Manifest
- [ ] No non-procedural combatant above `128x128`.
- [ ] No non-procedural combatant with wrong anchor (`0.5, 1` required).
- [ ] Atlas dimensions never exceed `2048x2048`.
- [ ] Estimated atlas memory remains `<= 40 MB`.
- [ ] Non-procedural combatants have `atlasId` and `metaPath`.
- [ ] `framePattern=state_clip_index` matches accepted frame names.

## Functional Regression
- [ ] Combat flow: roll -> settle -> apply target works end-to-end.
- [ ] Drag/drop interactions remain stable.
- [ ] Swap/focus/status pulses still animate.
- [ ] Combat re-entry does not leak old entity bindings.
- [ ] Map miniatures remain same visual footprint after 128 internal migration.

## Visual Style Consistency
- [ ] Art Deco frame language visible in core screens.
- [ ] Pulp contrast and dark/gold hierarchy preserved.
- [ ] Icons remain readable in small mobile targets.
- [ ] Narrative event layout keeps short-form readability.
