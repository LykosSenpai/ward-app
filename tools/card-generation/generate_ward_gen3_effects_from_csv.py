#!/usr/bin/env python3
"""Rerunnable Gen 3 effect generator.
Run from the folder containing ward_gen3_1st_edition_card_library_combined.csv.
This generator uses the same heuristic action mapping as the initial package and is intended for edits/re-runs after manual CSV review.
"""
import csv, json, re
from pathlib import Path

INPUT = Path('ward_gen3_1st_edition_card_library_combined.csv')
GEN = '3'
EDITION = '1st Edition'
GLOBAL_RULES = {
  "wardRulesVersionSource": "Ward Rules Guide 2nd Edition, effective 2026-01-27",
  "maxArmorLevel": 12,
  "baseHitDice": 2,
  "modifierAppliesTo": [
    "HIT_ROLL",
    "ATTACK_DAMAGE_ROLL"
  ],
  "atkBonusAppliesTo": [
    "ATTACK_DAMAGE_ROLL"
  ],
  "halfRoundingMode": "CEIL",
  "turnCycleDefinition": "One full round back to the same player; starts at the beginning of a player's turn.",
  "durationExpirationDefault": "Beginning of the start player's turn after the specified turn cycles complete.",
  "dotTickTiming": "END_OF_COMBAT_PHASE",
  "dotStacking": "DO_NOT_STACK",
  "hotTickTiming": "END_OF_COMBAT_PHASE",
  "creatureHpCannotGoBelow": 0,
  "creatureHealingCannotExceedBaseHp": true,
  "cemeteryHpCanGoBelow": 0,
  "infiniteMagicSlotLimit": 5,
  "limitedSummonMaxPerSide": 4,
  "limitedSummonsCannotReceiveHpDamage": true,
  "limitedSummonsLoseCreatureEffects": true,
  "limitedSummonsCannotBeSacrificed": true,
  "alchemyNotes": [
    "Modifier is separate from Atk. Modifier adds to both Hit Roll and Attack Damage Roll.",
    "Atk adds only to Attack Damage Roll.",
    "Half values round up.",
    "Field detection is separated from Magic Type. Magic Type is Standard/Infinite/Lightning; Magic Subtype is None/Equip/Field.",
    "Generation 3 is 1st Edition based on the printed card footer and user confirmation.",
    "Card 151/150 Eagle Family is included as a bonus card."
  ]
}
STAT_PATTERNS = [
    (r'Atk Dice Rolls\s*:\s*([+-]?\s*\d+)', 'ATK_DICE_ROLLS'),
    (r'Hit Dice Rolls\s*:\s*([+-]?\s*\d+)', 'HIT_DICE_ROLLS'),
    (r'Atk Dice Rolls\s*([+-]\s*\d+)', 'ATK_DICE_ROLLS'),
    (r'Hit Dice Rolls\s*([+-]\s*\d+)', 'HIT_DICE_ROLLS'),
    (r'Atk\s*:\s*([+-]?\s*\d+)', 'ATK_BONUS'),
    (r'Hit\s*:\s*([+-]?\s*\d+)', 'HIT_BONUS'),
    (r'AL\s*:\s*([+-]?\s*\d+)', 'AL'),
    (r'SPD\s*:\s*([+-]?\s*\d+)', 'SPD'),
    (r'Modifier\s*:\s*([+-]?\s*\d+)', 'MODIFIER'),
]
def parse_int(v): return int(v.replace(' ',''))
def stat_changes(text):
    out=[]; seen=set()
    for pat,stat in STAT_PATTERNS:
        for m in re.finditer(pat,text,flags=re.I):
            try: val=parse_int(m.group(1))
            except Exception: continue
            if (stat,val) not in seen:
                out.append({'stat':stat,'operation':'ADD','value':val}); seen.add((stat,val))
    return out
def duration(text, card):
    low=text.lower()
    for n in (3,2,1):
        if f'{n} turn cycle' in low:
            return {'text':f'{n} turn cycles' if n!=1 else '1 turn cycle','type':'TURN_CYCLES','amount':n,'unit':'TURN_CYCLE','starts':'EFFECT_ACTIVATION','expires':'BEGINNING_OF_START_PLAYER_TURN'}
    if card['magicSubtype']=='EQUIP': return {'text':'While equipped','type':'WHILE_EQUIPPED'}
    if card['magicSubtype']=='FIELD': return {'text':'While on field','type':'WHILE_ON_FIELD'}
    return {'text':'Immediate','type':'IMMEDIATE'}
def trigger(text, card):
    low=text.lower()
    if low.startswith('summon requirement') or 'can only be summoned' in low: return 'SUMMON_REQUIREMENT'
    if 'when summoned' in low: return 'ON_SUMMON'
    if 'when your opponent plays a magic' in low: return 'WHEN_OPPONENT_PLAYS_MAGIC'
    if 'when your opponent plays a lightning' in low: return 'WHEN_OPPONENT_PLAYS_LIGHTNING'
    if 'when your primary creature is killed' in low: return 'WHEN_YOUR_PRIMARY_CREATURE_KILLED'
    if 'when your opponent declares battle' in low: return 'WHEN_OPPONENT_DECLARES_BATTLE'
    if 'when your opponent finishes their attack' in low: return 'WHEN_OPPONENT_FINISHES_ATTACK'
    if 'when this creature hits' in low or 'if this creature hits' in low: return 'ON_HIT'
    if 'when this creature is hit' in low: return 'WHEN_THIS_CREATURE_IS_HIT'
    if 'if this card is killed' in low or 'if this creature is killed' in low: return 'WHEN_THIS_CREATURE_KILLED'
    if 'beginning of your turn' in low: return 'BEGINNING_OF_YOUR_TURN'
    if 'during battle' in low: return 'DURING_BATTLE'
    if 'during your turn' in low: return 'DURING_YOUR_TURN_ACTIVATED'
    if card['magicSubtype']=='EQUIP': return 'WHILE_EQUIPPED'
    if card['magicSubtype']=='FIELD': return 'STATIC_WHILE_ON_FIELD'
    return 'ON_PLAY'
def actions(text):
    low=text.lower(); out=[]
    def add(a,g,fn): out.append((a,g,fn))
    if 'limited summon' in low: add('LIMITED_SUMMON','Limited Summon','limitedSummon')
    if 'destroy all magic' in low: add('DESTROY_ALL_MAGIC','Magic Destruction','destroyAllMagic')
    elif 'destroy 1 magic' in low or 'destroy this card' in low: add('DESTROY_MAGIC','Magic Destruction','destroyMagic')
    if 'negate' in low: add('NEGATE_CARD_EFFECT','Negation','negateCardEffect')
    if 'cannot play' in low or 'cannot use lightning' in low: add('PREVENT_CARD_PLAY','Play Restriction','preventCardPlay')
    if 'heal' in low: add('HEAL','Healing','heal')
    if 'damage' in low: add('APPLY_DAMAGE_OVER_TIME' if 'once per turn cycle' in low else 'DAMAGE','Damage','applyDamageOverTime' if 'once per turn cycle' in low else 'damage')
    if '2x atk damage' in low or '3x atk damage' in low or 'critical hit' in low: add('APPLY_ATTACK_DAMAGE_MULTIPLIER','Damage Multiplier','applyAttackDamageMultiplier')
    if 're-roll' in low or 'reroll' in low: add('REROLL_DICE','Dice Reroll','rerollDice')
    if 'roll 1 die' in low or '1-2' in low or '3-4' in low or '5-6' in low: add('ROLL_TABLE','Roll Table','resolveRollTable')
    if 'return' in low or 'send' in low and 'cemetery' in low: add('MOVE_CARD','Card Movement','moveCard')
    if 'discard' in low: add('DISCARD_CARD','Discard','discardCard')
    if 'shuffle' in low: add('SHUFFLE_DECK','Deck','shuffleDeck')
    if 'unaffected' in low or 'not affected' in low: add('UNAFFECTED_BY_MAGIC','Immunity','applyImmunity')
    if stat_changes(text) or re.search(r'(set|changed|reduced|equal|switch|add).*?(atk|hit|al|spd|modifier|dice)', low): add('APPLY_STAT_MODIFIER','Stat Modifier','applyStatModifier')
    if not out: add('MANUAL_FALLBACK','Manual Fallback','manualFallback')
    result=[]; seen=set()
    for a in out:
        if a[0] not in seen: result.append(a); seen.add(a[0])
    return result
def target(text, card):
    low=text.lower()
    if 'opponent' in low and 'primary creature' in low: return "Opponent's primary creature"
    if 'your primary creature' in low: return 'Your primary creature'
    if 'equipped creature' in low or card['magicSubtype']=='EQUIP': return 'Equipped creature'
    if 'all creatures' in low: return 'All creatures matching condition'
    if 'magic card' in low: return 'Magic card(s)'
    if 'this creature' in low or card['cardKind']=='CREATURE': return 'This creature'
    return 'Target as specified'
def effectify(card):
    text=card['rawEffectText']
    if not text.strip(): return []
    eff=[]
    for i,(a,g,fn) in enumerate(actions(text),1):
        dur=duration(text, card); sc=stat_changes(text) if a=='APPLY_STAT_MODIFIER' else []
        params={'target':target(text, card),'valueText':text,'statChanges':sc,'duration':dur,'damageType':'ATTACK_DAMAGE' if 'Atk damage' in text else ('INSTANT_DAMAGE' if 'damage' in text.lower() else ''),'sourceLinked':any(x in text.lower() for x in ['leaves the field','changes control','effect is negated','return it','destroyed']),'usesAnchoring':'limited summon' in text.lower() or card['magicSubtype']=='EQUIP','roundingMode':'CEIL' if '1/2' in text else None}
        eff.append({'id':f"{card['cardNumber']}-E{i:02d}",'trigger':trigger(text, card),'condition':{'type':'TEXT','text':text},'actionType':a,'effectGroup':g,'actionText':g,'target':params['target'],'value':text,'duration':dur,'reusableFunction':fn,'params':params,'notes':card.get('notes',''),'needsReview':True})
    return eff
def as_int(v):
    v=(v or '').strip()
    return int(v) if v else None
cards=[]
with INPUT.open(newline='',encoding='utf-8-sig') as f:
    for r in csv.DictReader(f):
        c={'cardNumber':r['Card Number'].zfill(3),'cardName':r['Card Name'],'generation':GEN,'edition':EDITION,'cardKind':r['Card Kind'].upper(),'rarity':r['Rarity'],'creatureType':r['Creature Type'] or None,'magicType':(r['Magic Type'] or '').upper() or None,'magicSubtype':(r['Magic Subtype'] or '').upper() or None,'isEquip':r['Is Equip'].upper()=='TRUE','isField':r.get('Is Field','').upper()=='TRUE','baseStats':{'AL':as_int(r['AL']),'SPD':as_int(r['SPD']),'HP':as_int(r['HP']),'attackName':r['Attack Name'] or None,'attackDice':as_int(r['Attack Dice']),'modifier':as_int(r['Modifier']),'baseHitDice':2 if r['Card Kind'].upper()=='CREATURE' else None},'rawEffectText':r['Raw Effect Text'],'notes':r.get('Notes','')}
        c['effects']=effectify(c); cards.append(c)
Path('ward_gen3_effects_engine_ready.json').write_text(json.dumps({'globalRules':GLOBAL_RULES,'cards':cards},indent=2,ensure_ascii=False),encoding='utf-8')
print(f'Generated {len(cards)} cards and {sum(len(c["effects"]) for c in cards)} effects')
