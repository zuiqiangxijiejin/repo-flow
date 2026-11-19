"use client";

import {
  CheckIcon,
  LightbulbIcon,
  ListChecksIcon,
  RocketIcon,
  ZapIcon,
} from "lucide-react";

import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/core/i18n/hooks";
import type { Translations } from "@/core/i18n/locales/types";
import {
  isThinkingRequired,
  supportsThinking,
  type InputMode,
} from "@/core/models/reasoning";
import type { Model } from "@/core/models/types";
import { cn } from "@/lib/utils";

import { Tooltip } from "./tooltip";

export type AgentMode = InputMode;

const modeOrder: AgentMode[] = ["flash", "thinking", "pro", "ultra"];

const modeIcons = {
  flash: ZapIcon,
  thinking: LightbulbIcon,
  pro: ListChecksIcon,
  ultra: RocketIcon,
};

export function ModeIcon({
  mode,
  className,
}: {
  mode: AgentMode;
  className?: string;
}) {
  const Icon = modeIcons[mode];
  return <Icon aria-hidden="true" className={className} />;
}

export function getModeLabelKey(
  mode: AgentMode,
): keyof Pick<
  Translations["inputBox"],
  "flashMode" | "reasoningMode" | "proMode" | "ultraMode"
> {
  switch (mode) {
    case "flash":
      return "flashMode";
    case "thinking":
      return "reasoningMode";
    case "pro":
      return "proMode";
    case "ultra":
      return "ultraMode";
  }
}

function getModeDescriptionKey(
  mode: AgentMode,
): keyof Pick<
  Translations["inputBox"],
  | "flashModeDescription"
  | "reasoningModeDescription"
  | "proModeDescription"
  | "ultraModeDescription"
> {
  switch (mode) {
    case "flash":
      return "flashModeDescription";
    case "thinking":
      return "reasoningModeDescription";
    case "pro":
      return "proModeDescription";
    case "ultra":
      return "ultraModeDescription";
  }
}

export function ModeMenuOptions({
  mode,
  model,
  onSelect,
}: {
  mode: AgentMode;
  model?: Model;
  onSelect: (mode: AgentMode) => void;
}) {
  const { t } = useI18n();
  const canUseFlash = !isThinkingRequired(model);
  const canUseReasoning = supportsThinking(model);
  const options = modeOrder.filter(
    (option) =>
      (option !== "flash" || canUseFlash) &&
      (option !== "thinking" || canUseReasoning),
  );

  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel className="text-muted-foreground text-xs">
        {t.inputBox.mode}
      </DropdownMenuLabel>
      {options.map((option) => {
        const selected = mode === option;
        return (
          <DropdownMenuItem
            key={option}
            aria-current={selected || undefined}
            className={cn(
              "text-foreground items-start py-2",
              selected && "bg-accent text-accent-foreground",
            )}
            onSelect={() => onSelect(option)}
          >
            <ModeIcon mode={option} className="mt-0.5 size-4 text-current" />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="font-semibold">
                {t.inputBox[getModeLabelKey(option)]}
              </div>
              <div className="text-muted-foreground text-xs">
                {t.inputBox[getModeDescriptionKey(option)]}
              </div>
            </div>
            <CheckIcon
              aria-hidden="true"
              className={cn(
                "text-primary mt-0.5 size-4",
                !selected && "invisible",
              )}
            />
          </DropdownMenuItem>
        );
      })}
    </DropdownMenuGroup>
  );
}

export function ModeHoverGuide({
  mode,
  children,
  showTitle = true,
}: {
  mode: AgentMode;
  children: React.ReactNode;
  /** When true, tooltip shows "ModeName: Description". When false, only description. */
  showTitle?: boolean;
}) {
  const { t } = useI18n();
  const label = t.inputBox[getModeLabelKey(mode)];
  const description = t.inputBox[getModeDescriptionKey(mode)];
  const content = showTitle ? `${label}: ${description}` : description;

  return <Tooltip content={content}>{children}</Tooltip>;
}
