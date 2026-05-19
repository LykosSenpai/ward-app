export type GameplayKeybindingAction =
  | "swapPlayerView"
  | "drawCards"
  | "advancePhase"
  | "undoLastAction"
  | "rollBoardDice"
  | "openEventLog"
  | "openSaveLoad";

export type GameplayKeybindingDefinition = {
  action: GameplayKeybindingAction;
  label: string;
  description: string;
  defaultCode: string;
  suggestedCode?: string;
};

export type GameplayKeybindings = Record<GameplayKeybindingAction, string>;

const KEYBINDING_STORAGE_KEY = "ward.gameplayKeybindings.v1";
export const GAMEPLAY_KEYBINDINGS_CHANGED_EVENT = "ward:gameplay-keybindings-changed";

export const GAMEPLAY_KEYBINDING_DEFINITIONS: GameplayKeybindingDefinition[] = [
  {
    action: "swapPlayerView",
    label: "Swap Solo View",
    description: "Flip the solo board perspective between Player 1 and Player 2.",
    defaultCode: "KeyZ"
  },
  {
    action: "drawCards",
    label: "Draw Cards",
    description: "Draw for the active turn, or resolve a pending manual draw effect for your seat.",
    defaultCode: "KeyD"
  },
  {
    action: "advancePhase",
    label: "Advance Phase",
    description: "Advance when the current phase is not blocked.",
    defaultCode: "",
    suggestedCode: "KeyA"
  },
  {
    action: "undoLastAction",
    label: "Undo Last Action",
    description: "Undo when the current seat is allowed to act.",
    defaultCode: "",
    suggestedCode: "KeyU"
  },
  {
    action: "rollBoardDice",
    label: "Roll Board Dice",
    description: "Trigger the active dice action shown on the 3D game board.",
    defaultCode: "KeyR"
  },
  {
    action: "openEventLog",
    label: "Event Log",
    description: "Open the match event log.",
    defaultCode: "",
    suggestedCode: "KeyL"
  },
  {
    action: "openSaveLoad",
    label: "Save / Load",
    description: "Open match save and load tools.",
    defaultCode: "",
    suggestedCode: "KeyS"
  }
];

const LEGACY_GAMEPLAY_KEYBINDING_ACTIONS: Partial<Record<string, GameplayKeybindingAction>> = {
  openDiceRoller: "rollBoardDice"
};

export const DEFAULT_GAMEPLAY_KEYBINDINGS = GAMEPLAY_KEYBINDING_DEFINITIONS.reduce(
  (bindings, definition) => ({
    ...bindings,
    [definition.action]: definition.defaultCode
  }),
  {} as GameplayKeybindings
);

function getBrowserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isGameplayKeybindingAction(value: string): value is GameplayKeybindingAction {
  return GAMEPLAY_KEYBINDING_DEFINITIONS.some(definition => definition.action === value);
}

export function readGameplayKeybindings(): GameplayKeybindings {
  const raw = getBrowserStorage()?.getItem(KEYBINDING_STORAGE_KEY);
  if (!raw) return { ...DEFAULT_GAMEPLAY_KEYBINDINGS };

  try {
    const parsed = JSON.parse(raw) as Partial<Record<string, unknown>>;
    const bindings = { ...DEFAULT_GAMEPLAY_KEYBINDINGS };

    for (const [action, code] of Object.entries(parsed)) {
      if (isGameplayKeybindingAction(action) && typeof code === "string") {
        bindings[action] = code;
        continue;
      }

      const migratedAction = LEGACY_GAMEPLAY_KEYBINDING_ACTIONS[action];
      if (migratedAction && typeof code === "string" && code) {
        bindings[migratedAction] = code;
      }
    }

    return bindings;
  } catch {
    return { ...DEFAULT_GAMEPLAY_KEYBINDINGS };
  }
}

export function writeGameplayKeybindings(bindings: GameplayKeybindings): void {
  try {
    getBrowserStorage()?.setItem(KEYBINDING_STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    // Storage can be blocked by browser settings; keep the in-memory update.
  }

  globalThis.dispatchEvent?.(
    new CustomEvent<GameplayKeybindings>(GAMEPLAY_KEYBINDINGS_CHANGED_EVENT, {
      detail: bindings
    })
  );
}

export function resetGameplayKeybindings(): GameplayKeybindings {
  const bindings = { ...DEFAULT_GAMEPLAY_KEYBINDINGS };
  writeGameplayKeybindings(bindings);
  return bindings;
}

export function assignGameplayKeybinding(
  bindings: GameplayKeybindings,
  action: GameplayKeybindingAction,
  code: string
): GameplayKeybindings {
  const next = { ...bindings };

  if (code) {
    for (const definition of GAMEPLAY_KEYBINDING_DEFINITIONS) {
      if (definition.action !== action && next[definition.action] === code) {
        next[definition.action] = "";
      }
    }
  }

  next[action] = code;
  return next;
}

export function getGameplayKeybindingActionByCode(
  bindings: GameplayKeybindings,
  code: string
): GameplayKeybindingAction | undefined {
  if (!code) return undefined;

  return GAMEPLAY_KEYBINDING_DEFINITIONS.find(
    definition => bindings[definition.action] === code
  )?.action;
}

export function formatKeybindingCode(code: string): string {
  if (!code) return "Unassigned";
  if (code.startsWith("Key")) return code.slice(3).toUpperCase();
  if (code.startsWith("Digit")) return code.slice(5);

  const namedKeys: Record<string, string> = {
    Space: "Space",
    Enter: "Enter",
    Escape: "Esc",
    Backspace: "Backspace",
    Delete: "Delete",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backslash: "\\",
    Backquote: "`"
  };

  return namedKeys[code] ?? code;
}

export function isEditableKeybindingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;

  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.closest("[contenteditable='true']") !== null
  );
}
