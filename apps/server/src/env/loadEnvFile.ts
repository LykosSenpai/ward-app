import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const externallyDefinedKeys = new Set(Object.keys(process.env));

function findWorkspaceRoot(startDir: string): string | null {
  let current = path.resolve(startDir);

  while (true) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function stripInlineComment(value: string): string {
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const previous = index > 0 ? value[index - 1] : "";

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote && previous !== "\\") {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (char === "#" && !inSingleQuote && !inDoubleQuote) {
      const before = index > 0 ? value[index - 1] : "";
      if (!before || /\s/.test(before)) {
        return value.slice(0, index).trimEnd();
      }
    }
  }

  return value;
}

function unquote(value: string): string {
  const trimmed = stripInlineComment(value.trim());

  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];

    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      const inner = trimmed.slice(1, -1);
      return first === '"'
        ? inner
            .replace(/\\n/g, "\n")
            .replace(/\\r/g, "\r")
            .replace(/\\t/g, "\t")
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, "\\")
        : inner;
    }
  }

  return trimmed;
}

function parseEnvFile(text: string): Record<string, string> {
  const output: Record<string, string> = {};

  for (const rawLine of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) continue;

    const withoutExport = line.startsWith("export ") ? line.slice("export ".length).trimStart() : line;
    const equalsIndex = withoutExport.indexOf("=");

    if (equalsIndex <= 0) continue;

    const key = withoutExport.slice(0, equalsIndex).trim();
    const value = withoutExport.slice(equalsIndex + 1);

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    output[key] = unquote(value);
  }

  return output;
}

function loadEnvFile(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;

  const parsed = parseEnvFile(fs.readFileSync(filePath, "utf8"));

  for (const [key, value] of Object.entries(parsed)) {
    if (externallyDefinedKeys.has(key)) continue;
    process.env[key] = value;
  }

  return true;
}

const workspaceRoot = findWorkspaceRoot(process.cwd()) ?? findWorkspaceRoot(moduleDir) ?? process.cwd();
const serverRoot = path.join(workspaceRoot, "apps", "server");

const loadedFiles = [
  path.join(workspaceRoot, ".env"),
  path.join(workspaceRoot, ".env.local"),
  path.join(serverRoot, ".env"),
  path.join(serverRoot, ".env.local")
].filter(loadEnvFile);

if (process.env.WARD_ENV_DEBUG === "1") {
  const relativeFiles = loadedFiles.map(filePath => path.relative(workspaceRoot, filePath) || ".env");
  console.log(relativeFiles.length ? `[env] Loaded ${relativeFiles.join(", ")}` : "[env] No .env files found.");
}
