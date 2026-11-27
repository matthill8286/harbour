# Harbour redesign: Impakt design system gaps

Source: Figma file "Harbour — Redesign" (pages 02 Business, 03 Customer portal, 04 Auth & access, 05 Components & tokens), read on 27 Nov 2026.
Target: `@atomic-ui/ui` 0.6.0 and `@atomic-ui/ui-react` from `impkt-design-system`.

Harbour's web app does not use the design system today. Every screen is hand-built with Tailwind and the old Fraunces and Nunito Sans theme in `apps/web/src/index.css`. The redesign moves it onto the `impakt-*` elements, themed with Harbour's own brand inputs.

## 1. Theme

The Figma "Harbour" variable collection, mode "Signal orange", becomes a set of brand inputs passed to `deriveTokens` from `@atomic-ui/design-tokens`.

| Figma variable | Value | Brand input or token |
| --- | --- | --- |
| accent/primary | #B24424 | `color.brand` |
| text/primary, bg/inverse | #0B1F33 | `color.text`, and the new inverse surface |
| bg/canvas | #DCE3E2 | the app frame behind the shell |
| bg/surface | #F2F5F4 | `color.surfacePage` |
| bg/card | #FFFFFF | `color.surfaceCard` |
| status/alert | #C2185B | `color.danger` |
| Urbanist Light to SemiBold | 300 to 600 | `font.body`, `font.heading`, web font weights `300 600` |
| Radius: tiles 18, cards 28, shell 36, pills full | | `shape.radiusBase` plus the new large radii |

### Contrast fixes made on 27 Nov 2026

The design system holds WCAG 2.2 AA, and four colour pairs in the Signal orange mode failed it. The variables were changed in Figma, in that mode only, and an annotation on the read-me's "Latest changes" frame explains the change for Yasya.

| Variable | Was | Now | Result |
| --- | --- | --- | --- |
| accent/primary | #E4572E | #B24424 | White text on it goes from 3.68 to 5.61. As text on accent/soft it goes from 3.0 to 4.57. |
| accent/hover | #CD4E29 | #9A3A1E | Still a step darker than primary, 7.0 with white. |
| accent/pressed | #B24424 | #86321A | Still a step darker than hover, 8.45 with white. |
| text/tertiary | #94A0A6 | #606D74 | Goes from 2.68 to 5.33 on white, and gives 4.54 on bg/sunken. |
| text/secondary | #5E6B73 | #4E5B62 | Stays a step darker than the new tertiary. |

Every screen reads these variables, so none was redrawn. Twenty hard-coded grey section labels on the Business, Customer portal and Auth pages were bound to text/secondary so they follow the variable.

## 2. What the design system already covers

These map straight onto existing elements and only need the Harbour theme.

| Figma component | Element | Notes |
| --- | --- | --- |
| Input (default, hover, focus, filled, error, disabled) | `impakt-text-input` | Label, helper and error text are built in. |
| Input/Textarea | `impakt-textarea` | |
| Select (route picker, filters, category) | `impakt-select` | |
| Checkbox | `impakt-checkbox` | The round task checkbox is part of the task row below. |
| Amount, € | `impakt-money-input` | Set `currency="EUR"`. |
| Dialog (cancel job, add leg, add task, sign out, edit and delete money line, edit stage, new route) | `impakt-dialog` | `phone-full-screen` is available, but the mobile designs use a bottom sheet instead, see section 3. |
| Avatar (small, medium, large) | `impakt-avatar` | Initials from `full-name`. |
| Banner (info, alert) | `impakt-alert` | GPS and tracker warnings. |
| Account menu | `impakt-menu` | Opens from the name chip. |
| Empty states (Board, Jobs, Files, Money, Notes, Activity, Customers, Trackers, Live map) | `impakt-empty-state` | |
| Could not load | `impakt-alert tone="danger"` or `impakt-empty-state` | |
| Files tab upload | `impakt-file-upload` | |
| Tracker unit, last seen, battery; contact; registered in | `impakt-summary-list` | |
| Card containers | `impakt-card` | Needs the larger card radius from the theme. |
| Logo | `impakt-logo` | The Harbour mark as an image. |
| Toasts after saves | `impakt-toast` | |
| Jobs list on desktop | `impakt-table` with `stack` | The Figma "Job row" is a table row: reference, vehicle, plate, customer, route, status, chevron. |
| New job steps | `impakt-progress` | Already announces "Step 2 of 3". |

## 3. What has to be added to the design system

Each item says whether it is a new element or a change to an existing one. They are listed in the order the screens need them.

### Changes to existing elements

1. **`impakt-button`: add `variant="dark"` and `variant="danger"`, and an icon-only form.** The design has five styles (Primary, Dark, Secondary, Ghost, Danger) at two sizes (44 and 34). The element has `primary`, `secondary` and `ghost`. The Figma "Icon button" set (Light, Sunken, Dark, Accent at 40px) becomes `impakt-button` with an `icon` and a required `label`, so it always has an accessible name.
2. **`impakt-badge`: add `tone="inverse"` and `tone="solid"`.** The Figma "Pill" has Light, Dark, Accent, Soft and Alert. Light, Soft and Alert are the existing `neutral`, `brand` and `danger`. Dark and Accent (filled) are missing.
3. **`impakt-tabs`: add `look="pill"`, a count per tab and a link mode.** The job workspace tabs are pills with a count ("Overview 2"), and each tab is a URL (`/jobs/:id?tab=money`). Today the tabs are underlined, have no count and only switch in-page panels.
4. **`impakt-drawer`: add `side="bottom"`.** Every mobile dialog is a bottom sheet: cancel job, add task, add leg, new customer, register tracker and assign tracker.
5. **`impakt-progress`: add a compact bar look.** "Journey progress" is five short bars (done in ink, current in accent, to come in grey) with the stage names under them. The element already has the right semantics and collapses to bars on small screens, so this is a look, not a new element.
6. **`impakt-text-input`: a leading search icon for `type="search"`.** The top bar search field and the Jobs and Customers search use it.
7. **`impakt-icon`: add the icons the design uses.** The set has 31 icons, already drawn at a 1.75 stroke. Harbour needs 17 more: layout-grid, clipboard-list, map-pinned, users, radio, settings, log-out, arrow-up-right, ellipsis, upload, image, lock, eye, trash-2, pencil, qr-code and battery-medium. The existing `close`, `home`, `warning` and `document` cover the design's x, house, triangle-alert and file-text.
8. **Urbanist 300 in Harbour's brand inputs.** The display style is Urbanist Light (56/60 and 40/46), and the Impakt theme loads 400 to 700. Harbour derives its own tokens, so its `font.webFonts` entry asks for 300 to 600. This needs no change to the design system.

### New elements

9. **`impakt-switch`** (Figma "Toggle", off and on). It is used for "Show to customer", "Visible to customer" on notes, and the workspace settings. It needs `role="switch"` and `aria-checked`, and it must be a form-associated element like the other inputs.
10. **`impakt-segmented-control`** (Figma "Segment" and "Segmented control"). It is used for Internal or Visible to customer on notes, and Cost or Charge on Money. It is a radio group drawn as joined buttons.
11. **`impakt-filter-chip`** (Figma "Chip", default, hover and active, with a count). The Jobs filter row is All, UK, Registration, Greece, Shipping, Cyprus and Completed, each with a count. The existing `impakt-chip` is a static label by design ("It says something; it does nothing"), so the pressable chip is a new element with `aria-pressed`.
12. **`impakt-side-nav`** (Figma "Nav item", default, hover, active). It is the desktop sidebar: an icon and a word for each item, the active item filled in ink, and Sign out pinned to the bottom. `impakt-nav` is a horizontal header nav and does not fit.
13. **`impakt-tab-bar`** (Figma "Tab bar item"). It is the floating dark bottom bar on mobile: Board, Jobs, Live map, Customers and More.
14. **`impakt-stat-tile`** (Figma "Stage tile" and the "Active import jobs" card). It shows a small uppercase label above a large Light number, with an optional caption and link. The Board uses six stage tiles and the hero count. It cannot be called `impakt-stat`, because that name is taken by a marketing block in `@atomic-ui/blocks`.
15. **`impakt-row`** (Figma "List row", "Attention row", "Arrival row" and "Task row"). These four are one pattern: an optional leading slot (a dot, a date tile, a checkbox), a title, a meta line, an optional trailing slot (a pill or a button) and an optional chevron when the row is a link. One element with slots covers all four, and it keeps the whole row as one link target.
16. **`impakt-date-tile`** (the orange "DEC 2" block in Arrival row). It shows a month and a day and reads as a full date to a screen reader. It goes in the leading slot of `impakt-row`.
17. **`impakt-app-shell`**. It is the product frame: the rounded canvas, the sidebar on the left, the top bar with workspace chip, search, primary action and account chip, and on mobile the dark header, light sheet and tab bar. Kleidi and the AI tools can use the same shell, which is why it belongs in the design system rather than in Harbour.

### Not for the design system

These stay in Harbour because they are specific to it.

- The vehicle hero (photo with status pills, customer chip and the journey bar with actions).
- The "Arriving next" card on the Board.
- The journey legs cards (01, 02, 03 with status). They are composed from `impakt-card`, `impakt-badge` and text.
- The Live map and job tracking map, which stay on Leaflet.
- The QR scanner on mobile.
- The sign-in brand panel with its timeline animation.

## 4. Work in the design that is not in the code

The Figma read-me lists features the redesign shows that Harbour does not have yet. They are API and data work, not design-system work, and they should be planned separately from the visual rebuild.

1. Several configurable routes per workspace, each with ordered stages, statuses and a "show to customer" switch.
2. The assign-tracker step when a job is marked Collected, and replacing a tracker from the job.
3. Global search in the top bar.
4. Dialogs instead of inline forms for cancel job, add leg, add task, replace tracker and sign out.
5. Profile editing, in-app password change and the account menu.
6. Customers editing their own contact details in the portal.
7. Signed-out, session-expired and access-turned-off screens.
8. Roles reduced to one Owner per workspace and Customers.
9. Money lines that can be edited and deleted, with every change written to Activity, and a required description when the category is Other.

## 5. Build order

1. **Design system, batch 1.** Button variants and icon-only buttons, badge tones, the extra icons, `impakt-switch` and `impakt-segmented-control`. Released in `@atomic-ui/ui` 0.7.0, with batch 2 and the product shell.
2. **Design system, batch 2.** `impakt-side-nav`, `impakt-tab-bar`, `impakt-app-shell`, `impakt-stat-tile`, `impakt-row`, `impakt-date-tile`, `impakt-filter-chip`, the pill tabs, the bottom drawer, the compact progress bars and the search icon. Released in 0.7.0 as well.
3. **Harbour theme and shell.** Add `@atomic-ui/ui` and `@atomic-ui/ui-react` to `apps/web`, derive the Harbour tokens, and replace `AppShell.tsx` with `impakt-app-shell`.
4. **Owner screens in the order of the Figma sections.** Board, Jobs, New job, Job workspace (Overview, Tracking, Files, Money, Activity, Notes), Customers, Trackers and Live map, Workspace and Account.
5. **Customer portal**, then **Auth and access**.
6. **Mobile layouts** for each screen as it is rebuilt, rather than at the end, because the shell already switches at the phone breakpoint.
