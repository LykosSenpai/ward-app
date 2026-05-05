import type { EffectTargetOption, PendingEffectTargetPrompt } from "@ward/shared";

type TargetPromptCardProps = {
  prompt: PendingEffectTargetPrompt;
  onResolve: (promptId: string, selectedOptionId: string) => void;
};

export function TargetPromptCard({
  prompt,
  onResolve
}: TargetPromptCardProps) {
  return (
    <section className="card target-prompt-card">
      <h2>Choose Effect Target</h2>

      <div className="effect-source-line">
        Source: <strong>{prompt.sourceCardName}</strong>
      </div>

      <div className="effect-source-line">
        Effect: <strong>{prompt.actionType}</strong>
        {prompt.effectGroup ? ` | ${prompt.effectGroup}` : ""}
      </div>

      <div className="effect-source-line">
        Target Kind: <strong>{prompt.targetKind}</strong>
      </div>

      {prompt.actionText && (
        <div className="effect-source-line">
          Action: {prompt.actionText}
        </div>
      )}

      {prompt.effectValue && (
        <div className="effect-source-line">
          Value: {prompt.effectValue}
        </div>
      )}

      <p>{prompt.promptText}</p>

      <div className="target-option-list">
        {prompt.options.map((option: EffectTargetOption) => (
          <button
            className="target-option-button"
            key={option.id}
            onClick={() => onResolve(prompt.id, option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </section>
  );
}
