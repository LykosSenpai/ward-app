import type { AppMatchState } from "../clientTypes";
import { getPlayerName } from "../gameViewHelpers";

type BattleResultCardProps = {
  match: AppMatchState;
};

function getCreatureKindLabel(kind?: string): string {
  if (kind === "LIMITED_SUMMON") return "Limited Summon";
  return "Primary";
}

export function BattleResultCard({ match }: BattleResultCardProps) {
  if (!match.lastBattle) {
    return null;
  }

  return (
    <section className="card battle-result-card">
      <h2>Last Battle Result</h2>

      <p>{match.lastBattle.message}</p>

      <div className="battle-summary-box">
        <strong>{getPlayerName(match, match.lastBattle.attackingPlayerId)}</strong>
        <span>
          Attacker type: {getCreatureKindLabel(match.lastBattle.attackingCreatureKind)}
        </span>
      </div>

      {match.lastBattle.speedTie && match.lastBattle.speedTieRolls && (
        <div className="battle-speed-box">
          <h3>Speed Tie Roll</h3>

          {Object.entries(match.lastBattle.speedTieRolls).map(([playerId, rolls]) => (
            <div key={playerId}>
              <strong>{getPlayerName(match, playerId)}:</strong> {rolls.join(", ")}
            </div>
          ))}
        </div>
      )}

      <div className="battle-strike-list">
        {match.lastBattle.strikes.map((strike, index) => (
          <div className="battle-strike" key={`${strike.attackerCreatureInstanceId}-${index}`}>
            <h3>
              Strike {index + 1}: {getPlayerName(match, strike.attackerPlayerId)}  -  {getCreatureKindLabel(strike.attackerCreatureKind)}
            </h3>

            <p>
              <strong>{strike.attackerCreatureName}</strong> attacked{" "}
              <strong>{strike.defenderCreatureName}</strong>.
            </p>

            <p>
              Hit Roll: {strike.hitRollDice.join(" + ")}
              {" + "}
              {strike.hitRollModifier}
              {" = "}
              <strong>{strike.hitRollTotal}</strong>
            </p>

            {strike.criticalHit && (
              <p className="good-text">Critical Hit: final attack damage doubled.</p>
            )}

            {strike.criticalMiss && (
              <p className="bad-text">
                Critical Miss: attack missed and self-damage was rolled.
              </p>
            )}

            {!strike.hit && !strike.criticalMiss && (
              <p className="bad-text">Missed. No damage dealt.</p>
            )}

            {strike.selfDamageDealt !== undefined && (
              <p>
                Self Damage: {strike.selfDamageDice?.join(" + ")} ={" "}
                <strong>{strike.selfDamageDealt}</strong>. Remaining HP:{" "}
                <strong>{strike.attackerRemainingHp}</strong>
              </p>
            )}

            {strike.selfDamagePreventedReason && (
              <p className="good-text">{strike.selfDamagePreventedReason}</p>
            )}

            {strike.hit && (
              <>
                <p>
                  Damage Roll: {strike.damageRollDice?.join(" + ")}
                  {" + "}
                  {strike.attackDamageModifier}
                  {" = "}
                  <strong>{strike.damageBeforeCritical}</strong>
                </p>

                <p>
                  Damage Dealt: <strong>{strike.damageDealt}</strong>
                </p>

                {strike.damagePreventedReason && (
                  <p className="good-text">{strike.damagePreventedReason}</p>
                )}

                <p>
                  Defender Remaining HP: <strong>{strike.defenderRemainingHp}</strong>
                </p>
              </>
            )}

            {strike.defenderKilled && (
              <p className="bad-text">
                {strike.defenderCreatureName} was killed and sent to cemetery.
              </p>
            )}

            {strike.attackerKilledByCriticalMiss && (
              <p className="bad-text">
                {strike.attackerCreatureName} was killed by critical miss self-damage.
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

