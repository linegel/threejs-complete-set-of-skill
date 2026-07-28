# Overloaded names — useful distinctions

The names on this page can hide materially different interactions. When a distinction affects
behaviour, states, input model, or failure/recovery, qualify the term enough for a reader to know what
is intended. If context already makes the behaviour clear, add no extra record.

Each row lists controls that may look similar while carrying different input models, states, and
failure modes. Use the distinction when it exposes a real design decision.

---

## "Dropdown" — at least eight controls

The most overloaded term here. Qualify it in a material interaction decision.

| Name | What it actually is |
|---|---|
| **Select** | Chooses one value from a predefined set. A form value, not a command. |
| **Native select** | The platform control. Free mobile behaviour, almost no styling. |
| **Listbox** | A visible list of selectable options. Not a popup by nature. |
| **Combobox** | An input *with an associated popup*, usually a listbox. Editable or select-only. |
| **Searchable select** | A select whose options can be filtered by typing. |
| **Dropdown menu** | A popup of **actions or commands** — not a form-value selector. |
| **Multi-select** | Permits several selected values. |
| **Token input** / **tag input** / **chip input** | Selected values become removable objects. |
| **Cascading select** / **tree select** | Selection at one level determines the next. |

A search field does **not** become a combobox merely because it filters something. ARIA's combobox
means an input widget with an associated popup.

**Cardinality, familiarity, and comparison needs decide the control — start from these defaults**:
2–4 options that benefit from simultaneous comparison → radio group or segmented control; a
familiar set up to roughly 7 → select; 10+ or unfamiliar options → filtering or search; hundreds or
unbounded → combobox with autosuggest; entity-bearing options → entity picker showing recognisable
identity. The numbers are defaults, not laws — deviate for a named reason (task frequency, label
length, device constraints, comparison needs, recognition versus recall) and record the reason when
it decides the control. A default that is occasionally wrong beats deliberation that never ends.

## "Filter input" vs search — behaviour decides the name

| Behaviour | Name |
|---|---|
| Typing narrows items **already displayed** | Live filter · instant filter · incremental filter |
| Queries a larger or remote set | Search field · search box |
| Predicts queries or values while typing | Autocomplete · autosuggest · typeahead |
| Type + select from an associated popup | Combobox |
| Narrows one table column | Column filter |
| Narrows by attribute groups | Faceted search |
| Applied criteria shown as removable objects | Filter chips · active-filter chips |
| Finds actions, pages, files, entities | Command palette · quick switcher · omnibox |
| Searches only the current page's text | Find in page · in-page search |
| Builds boolean conditions | Query builder |

## "Modal" — a kind of dialog, not a word for every overlay

| Name | What it is |
|---|---|
| **Dialog** | A separate interaction context layered over the interface. |
| **Modal dialog** | A dialog that **blocks** interaction with what is underneath. |
| **Non-modal dialog** | Stays open without blocking. |
| **Alert dialog** | Interruptive; requires acknowledgment or a decision. |
| **Drawer** / **side sheet** / **slide-over** | Edge-attached panel. |
| **Bottom sheet** | Panel entering from the bottom edge. |
| **Lightbox** | Media-focused overlay. |
| **Quick view** / **peek view** | Temporary object-detail view. |
| **Popover** | Contextual content that **may be interactive**. |
| **Tooltip** | Brief supplemental text, ordinarily **non-interactive**. |
| **Hover card** | Preview of an entity. |
| **Context menu** | Commands for a particular object or location. |

Tooltip vs popover is the most consequential pair here: putting an interactive control in a tooltip
is a defect, not a variant.

## "Tab" — three unrelated things

| Name | What it is |
|---|---|
| **Tabs** | Switch between associated content panels; one panel visible. |
| **Route tabs** | Navigate between peer routes. Different history and focus behaviour. |
| **Document tabs** | Represent multiple open documents; usually closable. |
| **Segmented control** | Selects a **mode, view, or value** — not panels. |
| **Toggle-button group** | Persistent pressed states or actions. |

Tabs and a segmented control can look identical and require different semantics and keyboard models.

## "Chip" / "badge" / "tag" / "pill"

| Name | What it is |
|---|---|
| **Badge** | A count, status, or marker attached to something. |
| **Status badge** | Compact status marker. |
| **Tag** | Descriptive categorization. |
| **Lozenge** | Compact rounded visual label. |
| **Chip** | Compact object that may be interactive, selectable, or removable. |
| **Pill** | **A shape, not a role.** Never a sufficient name. |
| **Filter chip** | A removable or selectable active filter. |
| **Input chip** / **token** | Represents entered or selected data. |

## "Toast" — transience is the decision

| Name | What it is |
|---|---|
| **Toast** | Transient system feedback. |
| **Snackbar** | Transient feedback, often with one contextual action. |
| **Inline message** | Placed beside the content it concerns. |
| **Banner** | Broad, persistent page- or section-level message. |
| **Alert** | Important message requiring timely perception. |
| **Notification** | Event message, possibly persistent. |
| **Error summary** | Form-level list of validation failures. |

**A toast must never be the only proof that important work succeeded.** Success shows the resulting
state; the toast is at most an accent on it. Important failure and recovery must likewise outlive
transient feedback.

## "Grid" — a table is not a grid

| Name | What it is |
|---|---|
| **Table** | Static tabular information. |
| **Data table** | Table with sorting, pagination, and similar features. |
| **Grid** | An **interactive** container using directional keyboard navigation. |
| **Data grid** | Highly interactive tabular control. |
| **Tree grid** | Hierarchical data grid. |
| **Spreadsheet grid** | Cell-oriented editable grid. |
| **Matrix** | Two-dimensional comparison display. |

ARIA explicitly distinguishes a static table from an interactive grid. Also unrelated: *layout
grid*, *card grid*, *bento grid* — those are layout, not controls.

## "Accordion" vs disclosure

- **Disclosure** — one control reveals or hides one region.
- **Accordion** — a *coordinated collection* of disclosures.
- **Expansion panel** — a design-system synonym for an accordion section.
- **Collapsible section** — a visual term; defines no behaviour by itself.

## Choice controls that look interchangeable and are not

- **Checkbox** — independent choice; may be checked, unchecked, or mixed.
- **Radio group** — one mutually exclusive selection.
- **Switch** — an **immediate** binary setting. Never use for a deferred action that needs Save.
- **Toggle button** — an action control whose pressed state persists.
- **Segmented control** — compact single-choice mode or view selection.

*Switch-for-delayed-action misuse* and *Checkbox-as-radio misuse* are both named anti-patterns.

## Loading indicators are not interchangeable

- **Spinner** — work is happening; structure and duration unknown.
- **Skeleton** — placeholder that **approximates the eventual structure**, so geometry survives.
- **Determinate progress bar** — completion proportion is known.
- **Indeterminate progress bar** — active, proportion unknown.
- **Buffering indicator** — waiting for sufficient buffered content.
- **Optimistic UI** — presents the expected successful result immediately.
- **Stale-data indicator** — content is visible but may no longer be current.

Choosing a spinner where a skeleton belongs is how a page arrives and then rearranges itself.

## Pagination family

- **Pagination** — discrete pages with explicit navigation.
- **Cursor pagination** — continuation cursors rather than page numbers.
- **Load more** — an explicit action appending a batch.
- **Infinite scroll** — automatic loading near the scroll boundary.
- **Virtualization / windowing** — renders only the visible subset. An implementation strategy, not
  a user-facing pattern; never a substitute for naming one.

## Menus

- **Navigation menu** — links to destinations.
- **Application menu** — commands acting inside the product.
- **Context menu** — commands for the selected object or location.
- **Mega menu** — large panel with grouped destinations.
- **Overflow menu** (kebab / meatballs / ellipsis) — less-prominent actions that do not fit.
- **Command palette** — searchable command and navigation interface.

*Menu-as-navigation misuse* and *Select-as-menu misuse* are both named anti-patterns.

---

## How to use this page

Use this page when a name is genuinely ambiguous in the current design:

1. Identify the intended role and behaviour.
2. Prefer a more specific shared term when it improves clarity.
3. Record a rejected alternative or selection factors only when they explain a material,
   non-obvious choice.
