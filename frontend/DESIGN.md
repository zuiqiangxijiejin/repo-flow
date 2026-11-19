# RepoFlow frontend design

The implementation is the source of truth: semantic tokens in `src/styles/globals.css`, workspace components, and extension-owned styles. Update this guide when their public layout changes.

## Surfaces and color

The workspace, authentication, settings and fullscreen Markdown previews share the current lavender palette. Keep the dark navigation sidebar and violet primary actions. Use semantic background, card, foreground, border, muted and focus-ring tokens in both themes; avoid fixed colors for surrounding UI.

Success, failure and diff additions/deletions use paired light/dark tokens plus readable text or icons. File-format identity tiles may use their existing green, blue, orange and purple pairs. Rendered document content preserves the author's colors.

The normal home page opens the workspace. Documentation remains reachable under the language-scoped docs routes. Blog and showcase routes are optional static-site surfaces; normal application redirects follow `next.config.js`. Optional task and usage pages open from settings. Avoid bringing back retired marketing sections as workspace navigation.

## Layout and text

The expanded sidebar is 16rem wide and collapses to a 4rem icon rail. Collapsed shortcut buttons are 44px square with a 12px radius. Native and extension controls use the same geometry, accessible labels and hover descriptions. Important sizing overrides belong in the base layer so they take precedence over generated utility rules.

Conversation titles, repository names, branches, models and action labels display completely. Use wrapping, stacking or scrolling rather than ellipses for meaningful content. Preserve the adjustable Git panel width. Ordinary conversation headers participate in layout and do not cover messages.

The composer can grow with its content. Its model label sits on the right beside the mode and send controls, uses natural width, and can shrink to wrap. The footer can move the controls as a group onto another row; preserve their order and separation.

## Components and ownership

Build from the existing Radix-based primitives. Files in `src/components/ui/` and `src/components/ai-elements/` are generated; regenerate them to make shared primitive changes. Keep workspace composition and styling outside generated files.

Use Lucide icons consistently. The repository extension uses its packaged SVG node data and retains its third-party notice. Shadow DOM assets follow the extension manifest. Container queries belong only on the sidebar root, so toolbar and composer surfaces retain their intrinsic width.

Use system UI type for controls and body text, with monospace for code and commit identifiers. Keep spacing consistent, borders quiet and shadows restrained. Existing loading skeletons, spinners and empty states should state the next useful action.

## Execution and Git review

Execution cards reflect actual streamed tool steps and counts. Git milestones derive from reviewed commits, exact push receipts and the current target's PR receipt. Distinguish draft, open, closed and merged states; never infer test success from a completed run.

Group contribution details, PR destination, PR information, save/push actions and GitHub submission actions. Save, push and PR creation have distinct meanings and confirmation flows. Keep actions visible with a disabled reason when unavailable. Form text and unsaved drafts survive target changes.

Large diffs append 200 lines per interaction while keeping the remaining lines available. Tables, code containers and fullscreen previews use the same semantic palette as the workspace.

## Dialogs and navigation

Dialog labels, fields and confirmation actions remain aligned in Chinese and English, light and dark themes, and narrow viewports. Long repository and branch details wrap. Modal content scrolls within the available viewport.

Radix dialogs and sheets lock body scrolling and pointer events. Nested portals stay within their allowed modal region; z-index alone cannot allow scrolling. In settings, query changes preserve the open section; close after a destination pathname has actually changed so URL cleanup cannot override navigation.

The docs header owns the single Nextra Search instance, including its mobile sheet. Search uses semantic tokens and the language-scoped Pagefind index. Headless UI search portals target the sheet content.

## Accessibility, motion and copy

Provide visible labels or `aria-label` values for inputs and icon controls. Preserve visible keyboard focus and sufficient contrast; status is never conveyed by color alone. Mobile touch targets are at least 44px tall.

Use short functional transitions, reuse existing named animations and honor reduced-motion preferences. Do not restart decorative loops during streamed re-renders.

User-facing strings have English and Chinese translations. Placeholders and loading text may use an ellipsis; labels and actionable content remain fully readable.
