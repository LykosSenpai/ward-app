import type { ReactNode } from "react";
import {
  formatKeybindingCode,
  type GameplayKeybindingAction,
  type GameplayKeybindings
} from "../keybindings";

type GameplayKeybindingHintProps = {
  action: GameplayKeybindingAction;
  keybindings?: GameplayKeybindings;
  className?: string;
};

type GameplayKeybindingLabelProps = GameplayKeybindingHintProps & {
  children: ReactNode;
};

export function getGameplayKeybindingHint(
  keybindings: GameplayKeybindings | undefined,
  action: GameplayKeybindingAction
): string | null {
  const code = keybindings?.[action];
  return code ? formatKeybindingCode(code) : null;
}

export function GameplayKeybindingHint({
  action,
  keybindings,
  className = ""
}: GameplayKeybindingHintProps) {
  const keyLabel = getGameplayKeybindingHint(keybindings, action);
  if (!keyLabel) return null;

  return (
    <kbd
      className={`gameplay-keybind-hint${className ? ` ${className}` : ""}`}
      title={`Shortcut: ${keyLabel}`}
      aria-label={`Shortcut ${keyLabel}`}
    >
      {keyLabel}
    </kbd>
  );
}

export function GameplayKeybindingLabel({
  action,
  keybindings,
  className = "",
  children
}: GameplayKeybindingLabelProps) {
  const keyLabel = getGameplayKeybindingHint(keybindings, action);

  return (
    <span className={`gameplay-keybind-label${className ? ` ${className}` : ""}`}>
      <span className="gameplay-keybind-label__text">{children}</span>
      {keyLabel ? (
        <kbd className="gameplay-keybind-hint" title={`Shortcut: ${keyLabel}`} aria-label={`Shortcut ${keyLabel}`}>
          {keyLabel}
        </kbd>
      ) : null}
    </span>
  );
}
