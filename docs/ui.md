# UI

The app is one window with several panels side by side. Controls that come from
different places read as sloppiness long before anyone works out why, so the
measurements are shared and the sharing is enforced in code rather than by
remembering.

This file is the **why**. The values themselves live in
`src/renderer/src/index.css`, and this file never restates one — a value written
down twice is two values that have not disagreed yet.

| What | Where |
| --- | --- |
| Tokens, feature palettes, control primitives | `src/renderer/src/index.css` |
| The controls themselves | `src/renderer/src/components/ui/` |
| The reasoning | this file |

## The rule that makes the rest work

**If changing something in one control would be a bug unless you changed it in
the others too, that thing is not the control's to own.** It belongs in
`index.css`, as a token or a `@utility`, and the control references it.

The test is not "is this repeated" but "would a reader be surprised if these two
disagreed". A shared focus ring passes. A variant's fill does not — a button and
a toggle are entitled to different opinions about what "on" looks like.

This is what survives a component being replaced. `button.tsx` could be deleted
and rewritten from scratch tomorrow; as long as the new one writes
`control-states`, the focus ring is still 2px, still neutral, still loses to a
bad value. It never owned any of that.

## The rules themselves

### No motion

No `transition-*`, no `duration-*`, no hover or opacity crossfades. This is an
IDE: every state change is a response to something the user just did, and a
transition puts time between the act and the answer.

`animate-spin` on a genuine in-flight spinner is the one exception. It reports
work rather than decorating a state change.

A value that moves continuously — a progress indicator's own fill — may
transition, for the same reason. The rule is about *state changes*, where a
transition puts time between the act and the answer; a download's progress is
neither a state change nor something the user just did, and stepping it would
make the indicator lag its own numbers in a way that reads as jitter. What
happens *around* it still does not animate: the app menu's download row swaps
to its restart row on the frame the download finishes.

### Measurements

Sizes come from the size variants on `Button` and `Toggle`, not from a height
picked at a call site. Spacing sits on a **4px grid** — Tailwind's half steps
(`mt-0.5`, `gap-1.5`, `p-2.5`) are 2, 6 and 10px and are off it; use `1`, `2`,
`3`. Focus rings are 2px; 3px reads blurry at this pixel density.

The "precisely engineered parts" image is about measurements — shared sizes,
shared rings, shared palettes — not about decoration.

### Every control rests the same

`border-input` over `bg-input/20` (`dark:bg-input/30`). `Toggle`, an outline
`Button`, `Input` and `SelectTrigger` are identical at rest in both themes,
because a filter chip, a level dropdown and a search field sit in one row in the
Log panel and any difference between them reads as two different kinds of thing.

`--border` separates *regions*. A control's outline is `--input`. The outline is
a step firmer than the separator in both themes, which is exactly enough to make
a row look like it was assembled from two kits if the two are mixed.

### A feature's colour means the thing is on

Nothing else. An off toggle is neutral all the way through, hover included — a
disarmed Auto-capture that is already green has spent the one signal the colour
was for, and the panel stops being able to say whether it is watching.

Feature palettes are applied through the `tone` prop, never by hand-writing
`bg-remote-surface` at a call site. The five roles and what each is for are
documented above the `tone-*` utilities in `index.css`.

### Nothing moves, and nothing is drawn outside the box

A control's state must not change its box or reflow the row it sits in. A toggle
wears its border in *every* state — off gives up the fill, not the outline — so
lighting one up only recolours a line already occupying its pixel. Not a ring:
rings sit outside the border-box and bleed into the gap beside a neighbour.

Disable rather than remove, so a row never reflows as things become available.

### A label is centred by its letters

`items-center` centres a line box, and where the letters sit inside it is the
font's doing. Measured off the rendered pixels, every Inter label at 12.5–13px
sat 1px high — panel titles, the file tree, the editor tabs — and the monospace
Hosting chip likewise. A single-line label in a box of fixed height takes
`text-trim`, which trims the line box to the letters so centring it centres
them; one that also truncates takes `truncate-trim`, since `truncate` on a
trimmed box cuts the tails off `y`, `g` and `p`. Give the box its height first —
a trimmed label no longer holds a row open. The utilities, and why, are in
`index.css`.

None of that survives a half pixel. A box centred in a space of the other parity
lands on one — a 20px chip in a 32px footer whose 1px border leaves 31 — and the
rounding then moves its border, its dot and its letters by different amounts.
A bar with a border takes `box-content`, so the border sits outside the height;
a row built from text gets line heights that add up to a whole number; an
`<input>` beside anything positioned against its wrapper is `block`, since an
inline input sits on a line box and pushes the wrapper half a pixel taller. The
title bar is the known exception: its 43px is Windows' caption strip.

Beside an icon or a dot, the capitals are what line up with it. An input's text
cannot be trimmed, so `Input` moves its padding a pixel up instead: Chromium
draws input text about a pixel below centre, and a placeholder read low against
the magnifier beside it.

### Panel actions are icon buttons

`<Button variant="ghost" size="icon-sm" aria-label="…"><Icon /></Button>`,
matching the Profiles panel's *New profile* button. A `variant="link"` text button is
unfinished scaffolding and should not survive into a panel.

## Adding a component

Everything here comes from shadcn. The project is configured already
(`components.json`, style `base-mira`, lucide icons), so:

```bash
npx shadcn@latest add <name> --yes
```

**What the CLI gives you is source material, not output.** Stock shadcn is
sized for a web page — `h-9` controls, `text-sm`, `transition-colors` on
everything, colours hardcoded to `bg-primary`. None of that is right here. Before
a file is finished it needs its transitions stripped, its sizes brought onto our
scale, its state classes replaced with `control-states`, and its colours pointed
at `--tone-*` where a feature might ever want to own them.

A file sitting in `components/ui/` is a promise that this has been done. Do not
leave an unadapted one there — an absent component makes the next person ask,
while a stock one makes them confident and wrong.

Never reach for a native `<select>`, `<input type="checkbox">`, or a
hand-rolled `<button>` with utility classes. If the component is missing, add
it.

## Changing a value

A visual value is **systemic until proven local**. Before changing one, find out
who owns it: grep it. If it is a token or `@utility` in `index.css`, or it
appears in three or more files, it belongs to the system.

- **Genuinely local** — one panel's max width, one empty state's copy. Just
  change it.
- **Systemic, and the request is really a system change** — "the corners are too
  round" is about `--radius`, which every control inherits. A spot fix would
  create drift. Say so, and name what the system-level change is.
- **Systemic, but a real local exception is wanted** — the answer is a named
  variant on the component, or a new token. Never a hardcoded override at a call
  site. A lone `rounded-[3px]` in a feature file is how the system erodes.

Surface, don't sweep. Being asked to change one thing is not authorisation to
change forty.

The same check applies when writing new UI: before hardcoding a value, look for
an existing token. Writing the third copy of something is the signal to promote
it — and to say so rather than quietly doing it.

## Moving something into `index.css`

Extraction is not a free refactor, and the diff will not show you why.

### It changes who wins

A custom `@utility` is emitted **ahead of every one of Tailwind's own
utilities**. So the moment a fragment moves out of a component and into
`index.css`, it stops competing on equal terms with the classes that component
writes alongside it: anything still spelled out at the call site now wins, where
before the two were ordered by Tailwind's own rules.

That is usually the outcome you want — a variant that bothers to state a focus
colour should get it — but it is a change in behaviour, not a refactor, and it
is silent.

### `@utility` drops half of what you write, without saying so

A `@utility` block emits **either top-level declarations or nested rules, never
both**. Write the obvious thing —

```css
@utility control-md {
  height: calc(var(--spacing) * 7);
  &:has([data-icon="inline-end"]) { padding-right: calc(var(--spacing) * 1.5); }
}
```

— and the height survives while the nested rule vanishes. No warning, no error,
nothing in the build output. `@apply` behaves identically: `@apply h-7
has-data-[icon=inline-end]:pr-1.5` emits the height alone.

The fix is to give every declaration a selector, so nothing is top-level:

```css
@utility control-md {
  & { height: calc(var(--spacing) * 7); }
  &:has([data-icon="inline-end"]) { padding-right: calc(var(--spacing) * 1.5); }
}
```

`control-states` and `control-icons` avoid the trap by accident — every utility
in them carries a variant, so there is no bare declaration to trip it.

Two utilities also cannot be relied on to order against each other: Tailwind
sorts them by name, *except* that one containing a `dark:` variant jumps ahead
of one that does not. If two rules must resolve in a fixed order, put them in
the same block.

### So check it

```bash
npm run check:cascade
```

It compiles the stylesheet as it is and as it was at a git ref, and compares
what actually resolves — per property, per element, per specificity. A
`REORDERED` line is a real visual difference. `SHADOWED` means a declaration
that never won anything went away, and nothing looks different.

Three latent bugs were found this way, none of them by reading the code:

- `Button`'s `destructive` variant sets `focus-visible:border-destructive/40`
  and a matching ring. The base `focus-visible:border-ring` was emitted after
  it and won, so none of it had ever been visible.
- `Checkbox`'s `aria-invalid:aria-checked:border-primary` was overridden in dark
  mode by the base invalid border.
- **Every icon in every `Button` and `Toggle` rendered at 16px.** The base
  string set `[&_svg:not([class*='size-'])]:size-4` and each size variant set
  its own smaller value, but Tailwind orders those by value, so the base's
  `size-4` won for every size. The whole per-size icon scale was dead except at
  `lg`.

## Deliberate exceptions

These are intentional. Do not "fix" them.

- The bespoke search fields in `variables/`, `remote-connect/file-list.tsx` and
  `remote-connect/code-input.tsx` are deliberate designs with inline icons.
- `rail.tsx` uses a raw `<button>` because it is a vertical `writing-mode`
  strip, which no shared control models.
- `editor-tabs.tsx` uses a raw `<button role="tab">` for the draggable,
  middle-click-to-close tab. It is a real candidate for extraction, but it is a
  tab strip, not a Button.

## Known drift

The size tables, the two stray font sizes and `Checkbox`'s missing resting fill
are all standardised, and stock shadcn's enter/exit animations are gone from
`ContextMenu`, `Dialog`, `Popover`, `Select` and `Tooltip`.

What an audit of the eleven controls turned up and left alone, because each
needs a decision rather than a sweep:

- **Three spellings of "smaller than `xs`".** `text-[0.625rem]` in `Button`,
  `Toggle` and `ContextMenu`, and `text-[11px]` in `Tooltip`. That is a type
  step the scale does not have; it wants a token, and then one name for it.
- **`Checkbox` sets `rounded-[4px]`**, which bypasses `--radius` entirely. Every
  other control derives its corner from it, so a change to `--radius` moves
  everything except the checkbox.
- **`text-sm` survives in `Dialog` and `Empty`** — stock shadcn's 0.875rem,
  where the app's body size is `text-xs/relaxed`.
- **Off the 4px grid**: `py-1.5` and `pl-7.5` through `ContextMenu`, `py-1.5`
  and `gap-1.5` in `SelectTrigger`, `pt-px pb-[3px]` in `Input` (see the
  note on input text above), and `px-2.5` in `control-lg`. Menu row rhythm is
  the visible one and is worth looking at rather than find-and-replacing.
- **`shadow-md` / `shadow-lg` on the four floating surfaces.** They already
  carry `ring-1 ring-foreground/10`; whether they should also cast a shadow is a
  question about the app's depth model, and it should be answered once for all
  four rather than per component.

If you add a value to one control that another will need, put it in `index.css`
before the second one needs it. A list like this is the symptom.
