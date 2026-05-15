import assert from "node:assert/strict";
import { EMBED_CHANNEL, EMBED_VERSION, isEmbedCommandType, parseEmbedMode, parseEmbedParentOrigin, parseReferrerOrigin } from "../src/embed/embedProtocol";
import { canApplyEmbedPage, canApplyEmbedView, parseRequestedEmbedView } from "../src/embed/embedGuards";

assert.equal(EMBED_CHANNEL, "ward-embed");
assert.equal(EMBED_VERSION, 1);

assert.equal(parseEmbedMode("?embed=1"), true);
assert.equal(parseEmbedMode("?embed=true"), true);
assert.equal(parseEmbedMode("?embed=0"), false);

assert.equal(parseEmbedParentOrigin("?parentOrigin=https%3A%2F%2Fexample.com%2Fabc"), "https://example.com");
assert.equal(parseEmbedParentOrigin("?parentOrigin=not-a-url"), null);
assert.equal(parseReferrerOrigin("https://example.org/path?q=1"), "https://example.org");
assert.equal(parseReferrerOrigin(""), null);

for (const type of ["set-page","set-view","set-animation-speed","focus-card","request-state","request-snapshot","request-capabilities"]) {
  assert.equal(isEmbedCommandType(type), true);
}
for (const type of ["ping","set-mode","unknown",""]) {
  assert.equal(isEmbedCommandType(type), false);
}

assert.equal(canApplyEmbedPage("play"), true);
assert.equal(canApplyEmbedPage("board-preview"), true);
assert.equal(canApplyEmbedPage("profile"), false);

assert.equal(canApplyEmbedView("board"), true);
assert.equal(canApplyEmbedView("split"), true);
assert.equal(canApplyEmbedView("text"), true);
assert.equal(canApplyEmbedView("board3d"), false);

for (const view of ["board","split","text","board3d","board-3d","3d"]) {
  assert.equal(parseRequestedEmbedView(`?view=${view}`), "board3d");
}
assert.equal(parseRequestedEmbedView("?view=unsupported"), null);

console.log("embed protocol checks passed");
