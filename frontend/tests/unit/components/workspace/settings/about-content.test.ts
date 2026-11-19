import { afterEach, expect, test, rs } from "@rstest/core";

const original = process.env.NEXT_PUBLIC_APP_VERSION;

afterEach(() => {
  rs.resetModules();
  if (original === undefined) {
    delete process.env.NEXT_PUBLIC_APP_VERSION;
  } else {
    process.env.NEXT_PUBLIC_APP_VERSION = original;
  }
});

test("aboutMarkdown heading interpolates the app version", async () => {
  process.env.NEXT_PUBLIC_APP_VERSION = "9.9.9-test";
  const { aboutMarkdown } =
    await import("@/components/workspace/settings/about-content");
  // The heading link text carries the version stamp.
  expect(aboutMarkdown).toContain("About RepoFlow 9.9.9-test");
  expect(aboutMarkdown).toContain("Settings → Optional features");
  expect(aboutMarkdown).toContain("MIT License");
  expect(aboutMarkdown).not.toContain("support@deerflow.tech");
});

test("aboutMarkdown heading reflects the package version when env is unset", async () => {
  delete process.env.NEXT_PUBLIC_APP_VERSION;
  const { APP_VERSION } = await import("@/version");
  const { aboutMarkdown } =
    await import("@/components/workspace/settings/about-content");
  // Positive: the heading carries the real resolved version. This catches an
  // empty or undefined APP_VERSION interpolation (`About DeerFlow ]` /
  // `About DeerFlow undefined]`), not just removal of the old literal.
  expect(aboutMarkdown).toContain(`About RepoFlow ${APP_VERSION}`);
});
