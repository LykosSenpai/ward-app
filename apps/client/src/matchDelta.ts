import type { AppMatchState, MatchDeltaOperation, MatchDeltaPayload } from "./clientTypes";

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function decodePointerPart(value: string): string {
  return value.replace(/~1/g, "/").replace(/~0/g, "~");
}

function getPointerParts(path: string): string[] {
  if (path === "") return [];
  if (!path.startsWith("/")) {
    throw new Error(`Invalid patch path: ${path}`);
  }

  return path.slice(1).split("/").map(decodePointerPart);
}

function getPatchParent(root: unknown, parts: string[]): { parent: unknown; key: string } {
  if (parts.length === 0) {
    throw new Error("Root patch operations are not supported.");
  }

  let parent = root;
  for (const part of parts.slice(0, -1)) {
    if (Array.isArray(parent)) {
      const index = Number(part);
      parent = parent[index];
    } else if (parent && typeof parent === "object") {
      parent = (parent as Record<string, unknown>)[part];
    } else {
      throw new Error(`Patch path does not exist: /${parts.join("/")}`);
    }
  }

  return {
    parent,
    key: parts[parts.length - 1] ?? ""
  };
}

function applyOperation(root: AppMatchState, operation: MatchDeltaOperation): void {
  const parts = getPointerParts(operation.path);
  const { parent, key } = getPatchParent(root, parts);

  if (Array.isArray(parent)) {
    const index = key === "-" ? parent.length : Number(key);
    if (!Number.isInteger(index) || index < 0 || index > parent.length) {
      throw new Error(`Invalid array patch index: ${operation.path}`);
    }

    if (operation.op === "remove") {
      if (index >= parent.length) throw new Error(`Cannot remove missing array item: ${operation.path}`);
      parent.splice(index, 1);
      return;
    }

    if (operation.op === "add") {
      parent.splice(index, 0, operation.value);
      return;
    }

    if (index >= parent.length) throw new Error(`Cannot replace missing array item: ${operation.path}`);
    parent[index] = operation.value;
    return;
  }

  if (!parent || typeof parent !== "object") {
    throw new Error(`Patch path parent does not exist: ${operation.path}`);
  }

  const record = parent as Record<string, unknown>;
  if (operation.op === "remove") {
    delete record[key];
    return;
  }

  record[key] = operation.value;
}

export function applyMatchDelta(current: AppMatchState, delta: MatchDeltaPayload): AppMatchState {
  if (current.matchId !== delta.matchId) {
    throw new Error("Delta does not belong to the current match.");
  }

  const next = cloneJsonValue(current);

  for (const operation of delta.operations) {
    applyOperation(next, operation);
  }

  return next;
}
