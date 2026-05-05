# Blue Dragon Battle Trigger Patch

Fixes Blue Dragon defaulting `preventAttackDamage` to true in the manual battle resolver.

Root cause:
- Blue Dragon is `ROLL_FOR_EFFECT` with text saying the target becomes Frozen and "cannot inflict Atk damage" after a successful 4-6 effect roll.
- `battleEffectAdapter.ts` parsed that phrase as an immediate strike modifier before checking deferred effect rolls.
- The battle resolver then pre-checked "Prevent this strike's attack damage" for Blue Dragon.

Fix:
- `ROLL_FOR_EFFECT` / deferred effect-roll effects now return `BATTLE_TRIGGER` before runtime block text is converted into strike modifiers.
- The effect roll still happens after a hit through the existing effect-roll runtime.
