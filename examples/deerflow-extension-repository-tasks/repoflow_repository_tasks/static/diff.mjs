function pathFromHeader(line) {
  const path = line.slice(4);
  return path.replace(/^"(a|b)\//, '"').replace(/^(a|b)\//, "");
}

export function diffFiles(patch) {
  return patch.split(/(?=^diff --git )/m).filter(Boolean).map((chunk) => {
    const lines = chunk.replace(/\n$/, "").split("\n");
    const firstHunk = lines.findIndex((line) => line.startsWith("@@"));
    const metadata = firstHunk < 0 ? lines : lines.slice(0, firstHunk);
    const path = metadata.find((line) => line.startsWith("+++ ") && line !== "+++ /dev/null")
      ?? metadata.find((line) => line.startsWith("--- ") && line !== "--- /dev/null");
    const rename = metadata.find((line) => line.startsWith("rename to "));
    const name = path ? pathFromHeader(path) : rename
      ? rename.slice("rename to ".length)
      : lines[0].match(/ b\/(.+)$/)?.[1] ?? lines[0].slice("diff --git ".length);
    let added = 0;
    let deleted = 0;
    let before = 0;
    let after = 0;
    const rendered = (firstHunk >= 0 ? lines.slice(firstHunk) : lines).map((text) => {
      let kind = "";
      let oldLine = null;
      let newLine = null;
      const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
      if (hunk) {
        before = Number(hunk[1]);
        after = Number(hunk[2]);
        kind = "repo-hunk";
      } else if (firstHunk >= 0) {
        if (text.startsWith("+")) {
          kind = "repo-added";
          newLine = after++;
          added++;
        } else if (text.startsWith("-")) {
          kind = "repo-deleted";
          oldLine = before++;
          deleted++;
        } else if (text.startsWith(" ")) {
          oldLine = before++;
          newLine = after++;
        }
      }
      return { text, kind, oldLine, newLine };
    });
    return { name, added, deleted, lines: rendered };
  });
}
