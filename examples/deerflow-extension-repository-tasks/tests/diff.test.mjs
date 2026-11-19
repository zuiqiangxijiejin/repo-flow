import assert from "node:assert/strict";
import test from "node:test";

import { diffFiles } from "../repoflow_repository_tasks/static/diff.mjs";

test("lists modified, deleted and renamed files with hunk-only line counts", () => {
  const [edit, removed, renamed] = diffFiles([
    "diff --git a/read me.md b/read me.md",
    "--- a/read me.md",
    "+++ b/read me.md",
    "@@ -1 +1 @@",
    "-old",
    "+++ new  ",
    "diff --git a/gone.txt b/gone.txt",
    "--- a/gone.txt",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-content",
    "diff --git a/old b/new",
    "similarity index 100%",
    "rename from old",
    "rename to new",
    "",
  ].join("\n"));
  assert.equal(edit.name, "read me.md");
  assert.equal(edit.added, 1);
  assert.equal(edit.deleted, 1);
  assert.deepEqual(edit.lines.at(-1), {
    text: "+++ new  ", kind: "repo-added", oldLine: null, newLine: 1,
  });
  assert.deepEqual(edit.lines[1], {
    text: "-old", kind: "repo-deleted", oldLine: 1, newLine: null,
  });
  assert.equal(removed.name, "gone.txt");
  assert.equal(removed.deleted, 1);
  assert.deepEqual([renamed.name, renamed.added, renamed.deleted], ["new", 0, 0]);
  assert.deepEqual(diffFiles(""), []);
});

test("numbers context, insertion and deletion across separate hunks", () => {
  const [file] = diffFiles([
    "diff --git a/file b/file",
    "--- a/file",
    "+++ b/file",
    "@@ -3,2 +7,3 @@",
    " unchanged",
    "+new",
    " still unchanged",
    "@@ -30,1 +35,0 @@",
    "-gone",
    "\\ No newline at end of file",
  ].join("\n"));
  assert.deepEqual(
    file.lines.map(({ oldLine, newLine }) => [oldLine, newLine]),
    [[null, null], [3, 7], [null, 8], [4, 9], [null, null], [30, null], [null, null]],
  );
});
