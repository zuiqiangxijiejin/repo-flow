import { afterEach, expect, rs, test } from "@rstest/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";

import type * as SettingsStore from "@/components/workspace/settings/settings-dialog-store";
import {
  getSettingsDialogSnapshot,
  setSettingsDialogOpen,
} from "@/components/workspace/settings/settings-dialog-store";
import { WorkspaceSettingsDeepLink } from "@/components/workspace/workspace-settings-deep-link";

const navigation = rs.hoisted(() => ({
  params: new URLSearchParams("settings=capabilities&context=preserved"),
  router: { replace: rs.fn() },
}));
rs.mock("next/navigation", () => ({
  usePathname: () => "/workspace/chats/new",
  useRouter: () => navigation.router,
  useSearchParams: () => navigation.params,
}));
// Exercise the real external store without loading unrelated settings pages.
rs.mock("@/components/workspace/settings", () =>
  rs.requireActual<typeof SettingsStore>(
    "@/components/workspace/settings/settings-dialog-store",
  ),
);

afterEach(() => {
  cleanup();
  setSettingsDialogOpen(false);
  navigation.router.replace.mockClear();
});

test("keeps the opening deep link and tab parameters until settings closes", async () => {
  navigation.params = new URLSearchParams(
    "settings=capabilities&context=preserved",
  );
  const view = render(<WorkspaceSettingsDeepLink />);
  await waitFor(() => expect(getSettingsDialogSnapshot().open).toBe(true));
  expect(getSettingsDialogSnapshot().section).toBe("capabilities");
  expect(navigation.router.replace).not.toHaveBeenCalled();

  navigation.params = new URLSearchParams(
    "settings=capabilities&context=preserved&tab=skills",
  );
  view.rerender(<WorkspaceSettingsDeepLink />);
  expect(navigation.router.replace).not.toHaveBeenCalled();
  act(() => setSettingsDialogOpen(false));
  await waitFor(() =>
    expect(navigation.router.replace).toHaveBeenCalledWith(
      "/workspace/chats/new?context=preserved&tab=skills",
      { scroll: false },
    ),
  );
});

test("an inherited object key cannot select a settings section", () => {
  navigation.params = new URLSearchParams("settings=toString");
  render(<WorkspaceSettingsDeepLink />);
  expect(getSettingsDialogSnapshot().open).toBe(false);
  expect(navigation.router.replace).not.toHaveBeenCalled();
});
