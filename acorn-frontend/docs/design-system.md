# Acorn web design system

Tokens come from `sid-ui` (`sid-ui/styles/astryx.css`, `tokens.css`). The app adds none of its own.
This page says what each token **means** in Acorn, so one color never carries two jobs.

## Color: one token, one meaning

| Role                | Token                                                       | Use for                                      | Never for                                                 |
| ------------------- | ----------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------- |
| Brand / interactive | `--color-accent`                                            | Buttons, links, the active nav item, focus   | Data series, status, decoration                           |
| Success             | `--color-success`                                           | Completed, connected, positive deltas        | Brand moments                                             |
| Warning             | `--color-warning`                                           | Nearing a limit, needs attention             | Decoration                                                |
| Danger              | `--color-error`                                             | Failed, negative deltas, destructive actions | A mail label (a rejection email is a label, not an error) |
| Data series         | `--color-chart-*`                                           | Chart lines and bars only                    | Buttons, text, status                                     |
| Neutral             | `--color-text-*`, `--color-border*`, `--color-background-*` | Text, borders, surfaces                      | —                                                         |

Mail labels use the label's own hue (`labelBadge`), not the danger token.

## Type

Scale (`sid-ui`): `--font-size-sm` 12 · `base` 14 · `lg` 17 · `xl` 20 · `2xl` 24 · `3xl` 29 · `4xl` 35. One UI face
(`--font-family-body`) in the product. Headlines on the marketing site may use `--font-family-heading`.
Use `Heading` and `Text` from `sid-ui`; they pick the right step. No raw pixel sizes.

## Spacing

Steps of `--spacing-N` = N × 4px. Prefer the 8px multiples: `2` (8) · `4` (16) · `6` (24) · `8` (32) · `12` (48) · `16` (64).
Use the `gap` / `padding` props on `Stack`, `HStack`, `Card`, and `SectionCard` rather than local padding.

## Icons

`Glyph` / `icons` from `sid-ui` only. In navigation an icon always sits beside a visible label.

## Navigation

Workspace pages, each named identically everywhere: Statistics · Profile · Résumé · Connections · Billing.
Below the desktop breakpoint they collapse into one labelled menu. The account menu holds only actions
with no page of their own (Sign out).
