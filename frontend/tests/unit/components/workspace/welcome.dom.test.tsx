import { afterEach, expect, it, rs } from "@rstest/core";
import { cleanup, render } from "@testing-library/react";
import type { PropsWithChildren } from "react";

import { Welcome } from "@/components/workspace/welcome";
import { clientTranslations } from "@/core/i18n/client-translations";
import { I18nContext } from "@/core/i18n/context";

rs.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(cleanup);

function WelcomeLocale({ children }: PropsWithChildren) {
  return (
    <I18nContext.Provider
      value={{
        locale: "zh-CN",
        setLocale: rs.fn(),
        t: clientTranslations["zh-CN"],
      }}
    >
      {children}
    </I18nContext.Provider>
  );
}

it("shows the current mode icon beside the new chat heading", () => {
  const { container, rerender } = render(<Welcome />, {
    wrapper: WelcomeLocale,
  });
  expect(
    container.querySelector('svg.lucide-zap[aria-hidden="true"]'),
  ).not.toBeNull();

  for (const [mode, icon] of [
    ["thinking", "lightbulb"],
    ["pro", "list-checks"],
    ["ultra", "rocket"],
    ["flash", "zap"],
  ] as const) {
    rerender(<Welcome mode={mode} />);
    expect(container.querySelector(`svg.lucide-${icon}`)).not.toBeNull();
  }
});
