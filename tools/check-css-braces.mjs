import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CSS_ROOT = path.join(ROOT, "apps", "client", "src");

function walk(directory, results = []) {
  if (!fs.existsSync(directory)) return results;

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      walk(fullPath, results);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".css")) {
      results.push(fullPath);
    }
  }

  return results;
}

function stripComments(input) {
  return input.replace(/\/\*[\s\S]*?\*\//g, "");
}

function checkCssFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const css = stripComments(raw);
  const stack = [];
  const errors = [];

  let line = 1;
  let column = 0;

  for (let index = 0; index < css.length; index++) {
    const char = css[index];
    column++;

    if (char === "\n") {
      line++;
      column = 0;
      continue;
    }

    if (char === "{") {
      stack.push({ line, column });
      continue;
    }

    if (char === "}") {
      const opened = stack.pop();

      if (!opened) {
        errors.push(`Unexpected } at ${line}:${column}`);
      }
    }
  }

  for (const opened of stack) {
    errors.push(`Unclosed block opened at ${opened.line}:${opened.column}`);
  }

  return errors;
}

const files = walk(CSS_ROOT);
let errorCount = 0;

for (const file of files) {
  const errors = checkCssFile(file);

  if (errors.length > 0) {
    const relative = path.relative(ROOT, file);
    console.error(`\nCSS errors in ${relative}:`);

    for (const error of errors) {
      console.error(`  - ${error}`);
      errorCount++;
    }
  }
}

if (errorCount > 0) {
  console.error(`\nCSS check failed with ${errorCount} issue(s).`);
  process.exit(1);
}

console.log(`CSS check passed. Checked ${files.length} file(s).`);
