# Vocabulary: names that change behaviour

Use this file when a design names a control, pattern, or state and the name leaves behaviour, states,
input model, or recovery ambiguous. Each entry is a name and the behaviour that separates it from its
neighbours. Pick the name whose behaviour you mean, and write only the difference that matters into
the owning document.

This is a lookup. No entry creates an obligation to build, document, or review the thing it names. A
project may define a local term when none of these fits.

Families: [choosing a value from a set](#choosing-a-value-from-a-set) · [search and
filtering](#search-and-filtering) · [choice controls](#choice-controls) · [text entry and
forms](#text-entry-and-forms) · [pickers](#pickers) · [buttons](#buttons) · [menus](#menus) ·
[navigation](#navigation) · [tabs](#tabs) · [overlays](#overlays) · [disclosure](#disclosure) ·
[lists, tables, and grids](#lists-tables-and-grids) · [selection and direct
manipulation](#selection-and-direct-manipulation) · [chips, badges, and
tags](#chips-badges-and-tags) · [feedback and messaging](#feedback-and-messaging) · [validation
timing](#validation-timing) · [loading and progress](#loading-and-progress) ·
[pagination](#pagination) · [empty and blocked states](#empty-and-blocked-states) · [named
states](#named-states)

## Choosing a value from a set

"Dropdown" hides all of these. Qualify it whenever the choice is a material decision.

| Name | Behaviour |
|---|---|
| **Select** | One value from a predefined set. Holds a form value; never a command. |
| **Native select** | The platform control. Free mobile behaviour, minimal styling. |
| **Listbox** | A visible list of selectable options, single or multiple. Stays open; no popup. |
| **Combobox** | A text input with an associated popup, usually a listbox. Editable (free text is a value) or select-only. |
| **Searchable select** | A select whose options filter as the user types. Free text is never a value. |
| **Datalist** | Native input with suggested values; free text stays valid. |
| **Multi-select** | Several values from the set. Decide how selected values show when collapsed. |
| **Token input** / tag input / chip input | Selected values become removable objects inside the field. |
| **Cascading select** / tree select | Selection at one level determines the options at the next. |
| **Dual-list box** / transfer list | Moves items between an available list and a chosen list; suits large sets that must stay visible. |
| **Dropdown menu** | A popup of commands. Never a form value. See [menus](#menus). |

A search field that filters something is not thereby a combobox. Combobox means an input with an
associated popup.

Defaults, to deviate from for a named reason (task frequency, label length, device, comparison,
recognition versus recall) and to record when the reason decides the control:

| Options | Default |
|---|---|
| 2 to 4 that benefit from side-by-side comparison | Radio group or segmented control |
| A familiar set up to about 7 | Select |
| 10 or more, or unfamiliar | Filtering or search |
| Hundreds or unbounded | Combobox with suggestions |
| Entities | Entity picker showing recognisable identity |

## Search and filtering

| Behaviour | Name |
|---|---|
| Typing narrows items already displayed | **Live filter** / instant filter |
| Queries a larger or remote set on submit or as typed | **Search field** |
| Predicts queries or values while typing | **Autocomplete** / autosuggest / typeahead |
| Type, then select from an associated popup | **Combobox** |
| Narrows one table column | **Column filter** |
| Narrows by attribute groups with counts | **Faceted search** |
| Shows applied criteria as removable objects | **Filter chips** |
| Chooses the set to query before submitting | **Search-scope selector** |
| Reorders the current set without narrowing it | **Sort control** |
| Finds and invokes actions, pages, or entities | **Command palette** / quick switcher |
| Searches only the current page's text | **Find in page** |
| Builds boolean conditions | **Query builder** |
| Persists a query for later reuse | **Saved search** |

Decide the zero-results state for every search and filter; see [empty and blocked
states](#empty-and-blocked-states).

## Choice controls

| Name | Behaviour |
|---|---|
| **Checkbox** | Independent choice: checked, unchecked, or mixed. |
| **Checkbox group** | Several independent choices; zero selected is valid. |
| **Radio group** | Exactly one of a mutually exclusive set; arrow keys move the selection. |
| **Switch** | An immediate binary setting that takes effect on toggle. Never for a value that waits for Save. |
| **Toggle button** | A command whose pressed state persists. |
| **Segmented control** | One mode, view, or value from a compact visible set. Does not switch content panels; see [tabs](#tabs). |
| **Slider** | A value on a visible range, continuous or stepped; suits approximate values. |
| **Range slider** | Two thumbs select an interval. |
| **Spinbutton** / numeric stepper | Exact numeric value with increment and decrement; typing allowed. |
| **Number input** | Typed numeric value with no increment affordance. |
| **Rating input** | Ordinal choice on a fixed scale; decide hover preview and how to clear. |

Named misuses: a switch for a deferred action, and checkboxes acting as radios.

## Text entry and forms

| Name | Behaviour |
|---|---|
| **Text field** | Single-line free text. |
| **Textarea** | Multi-line free text; decide growth and maximum length. |
| **Rich-text editor** | Formatted content; decide the allowed formats and paste behaviour. |
| **Password field** | Masked text; decide the reveal control and paste policy. |
| **Input mask** | Constrains keystrokes to a pattern as typed. |
| **Formatter** | Reformats the value after entry; keystrokes stay free. |
| **Inline edit** | The value edits in place; decide the commit and cancel gestures. |
| **Editable cell** | Inline edit inside a grid; commit follows the grid's focus rules. |
| **Autosave form** | Persists drafts without an explicit action; decide the save indicator and the conflict rule. |
| **Draft form** | Explicitly saved partial state that survives leaving. |
| **Multi-step form** / wizard | One task across ordered steps with a step indicator; decide back navigation and whether steps persist. |
| **One-question-per-page form** | Each step holds one decision; suits assisted or low-confidence paths. |
| **Review-and-submit** | A summary step before the committing action; each item links back to its step. |
| **Repeatable field group** | Zero or more instances; decide add, remove, and reorder. |
| **Conditional field** | Appears from another field's value; decide what happens to its value when hidden. |
| **Character counter** | Shows used or remaining length; decide whether the limit blocks or warns. |
| **Error summary** | Form-level list of failures linking to each field; see [validation timing](#validation-timing). |

## Pickers

| Name | Behaviour |
|---|---|
| **Date input** | Typed date, keyboard first; the platform may add its own picker. |
| **Date picker** | Calendar popup for one date; typed entry stays available. |
| **Date-range picker** | Two dates as an interval; decide start-after-end handling and presets. |
| **Time picker** | Time of day; decide granularity and the 12-hour or 24-hour form. |
| **File input** / upload button | Opens the platform file chooser. |
| **Drop zone** | Accepts dragged files and opens the chooser on activation. |
| **Upload queue** | Lists uploads in progress with per-item progress, cancel, and retry. |
| **Verification-code input** / OTP input | Fixed-length code; paste fills every cell; auto-advance and auto-submit are decisions. |
| **Colour picker** | Colour value; decide accepted formats and the swatch set. |
| **People picker** / entity picker | Combobox whose options are entities shown with recognisable identity. |
| **Address lookup** | Fetches a structured address from partial input; manual entry stays available. |

## Buttons

| Name | Behaviour |
|---|---|
| **Button** | Performs a command. |
| **Submit button** | Commits the form; Enter in a field activates it. |
| **Menu button** | Opens a menu of commands. |
| **Split button** | A default command plus a menu of alternatives in one control. |
| **Disclosure button** | Shows or hides one region and carries its expanded state. |
| **Icon-only button** | No visible text; the name shows on hover or is given nearby. |
| **Destructive button** | Loses data; decide confirmation or undo. |
| **Floating action button** | The single primary action of a screen, floating over content. |
| **Bulk-action bar** | Commands that apply to the current selection; appears with the selection. |
| **Swipe action** | Command revealed by a horizontal swipe on a list item; needs a non-gesture equivalent. |

## Menus

| Name | Behaviour |
|---|---|
| **Navigation menu** | Links to destinations. |
| **Application menu** | Commands acting inside the product. |
| **Menu bar** | Persistent row of menus, each opening a submenu. |
| **Context menu** | Commands for the selected object or location, opened by right-click or long press. |
| **Overflow menu** (kebab, meatballs, ellipsis) | Less-prominent actions that do not fit. |
| **Mega menu** | Large panel of grouped destinations. |
| **Command palette** | Searchable commands and destinations. |

Named misuses: a menu used as navigation, and a select used as a menu.

## Navigation

| Name | Behaviour |
|---|---|
| **Navigation rail** | Compact, always-visible column of top-level destinations. |
| **Navigation drawer** | Off-canvas destinations opened on demand. |
| **Bottom navigation** / tab bar | Three to five top-level destinations, each keeping its own state. Not [tabs](#tabs). |
| **Location breadcrumb** | Position in a hierarchy. |
| **Path breadcrumb** | The route the user took; differs from location. |
| **Step indicator** / progress tracker | Position in a multi-step task; decide whether completed steps are navigable. Not a numeric stepper. |
| **Scrollspy** | Highlights the navigation item for the section in view. |

## Tabs

| Name | Behaviour |
|---|---|
| **Tabs** | Switch between associated content panels; one visible; arrow keys move between tabs. |
| **Route tabs** | Navigate between peer routes; each is a history entry. |
| **Document tabs** | Multiple open documents; usually closable and reorderable. |
| **Segmented control** | Selects a mode, view, or value; switches no panel. |
| **Toggle-button group** | Persistent pressed states or actions. |

Tabs and a segmented control can look identical and carry different semantics and keyboard models.

## Overlays

| Name | Behaviour |
|---|---|
| **Dialog** | A separate interaction context layered over the interface. |
| **Modal dialog** | Blocks and traps focus; Escape closes. Decide outside-click dismissal and the fate of a dirty form. |
| **Non-modal dialog** | Stays open without blocking. |
| **Alert dialog** | Interrupts; requires acknowledgment or a decision. |
| **Confirmation dialog** | Asks before a consequential action; the destructive choice is never the default. |
| **Full-screen dialog** | Takes the viewport for a task; decide the exit and whether progress persists. |
| **Drawer** / side sheet / slide-over | Edge-attached panel; decide whether it blocks. |
| **Bottom sheet** | Panel from the bottom edge; decide snap points and drag-to-dismiss. |
| **Lightbox** | Media-focused overlay. |
| **Quick view** / peek view | Temporary object detail without leaving the list. |
| **Popover** | Anchored contextual content that may be interactive; dismisses on outside click or Escape. |
| **Tooltip** | Brief supplemental text, never interactive; shows on hover and focus. |
| **Hover card** | Preview of an entity on hover; delayed open and close. |

An interactive control inside a tooltip is a defect. When overlays stack, decide which one Escape
closes.

## Disclosure

| Name | Behaviour |
|---|---|
| **Disclosure** | One control reveals or hides one region. |
| **Accordion** | A coordinated set of disclosures; decide whether more than one may be open. |
| **Expansion panel** | A design-system synonym for an accordion section. |
| **Read more** / truncate-and-expand | Reveals clipped text in place. |
| **Progressive disclosure** | A pattern: secondary detail appears on demand. Names no control. |

"Collapsible section" is a visual description and defines no behaviour.

## Lists, tables, and grids

| Name | Behaviour |
|---|---|
| **Table** | Static tabular information. |
| **Data table** | Table with sorting, filtering, pagination, or selection. |
| **Grid** | Interactive container with two-dimensional arrow-key navigation. |
| **Data grid** | Highly interactive tabular grid, often with editable cells. |
| **Tree grid** | Hierarchical rows in a grid. |
| **Spreadsheet grid** | Cell-oriented editable grid with fill and range operations. |
| **Tree view** | Hierarchy with expandable nodes; arrow keys expand, collapse, and move. |
| **Kanban board** | Columns of cards; moving a card between columns changes its state. |
| **Expandable row** | A row that reveals detail beneath itself. |
| **Sticky header** / frozen column | Header or column stays in view while the rest scrolls. |
| **Feed** | Reverse-chronological items that grow at one end; decide how new items announce themselves. |
| **Timeline** | Items on a time axis, past to future. |

A layout grid, card grid, or bento grid is layout and names no control. Virtualization is an
implementation strategy and never a substitute for naming the user-facing pattern.

## Selection and direct manipulation

| Name | Behaviour |
|---|---|
| **Single selection** | One item; selecting another replaces it. |
| **Multiple selection** | Items toggle independently; decide the modifier-key or checkbox model. |
| **Range selection** | Shift-click or drag selects a contiguous run. |
| **Select all** | Selects the visible page or the whole set; say which. The header checkbox shows mixed when partial. |
| **Marquee selection** | Drag a rectangle to select what it covers. |
| **Lasso selection** | Drag a freeform path. |
| **Drag to reorder** | Changes order within one container; decide the keyboard equivalent. |
| **Drag to move** | Changes container or parent. |
| **Drop indicator** | Shows where the drop lands: an insertion line or a highlighted target. |
| **Splitter** / sash | Resizes adjacent panels; decide minimum sizes and persistence. |
| **Long press** | Time-based activation; decide the duration and the visible cue. |
| **Pull to refresh** | Overscroll gesture that reloads; needs a non-gesture equivalent. |

## Chips, badges, and tags

| Name | Behaviour |
|---|---|
| **Badge** | A count, status, or marker attached to something. Never interactive. |
| **Tag** | Descriptive categorization. |
| **Lozenge** | Compact rounded status label. |
| **Chip** | Compact object that may be interactive, selectable, or removable. |
| **Filter chip** | A removable or selectable active filter. |
| **Input chip** / token | Represents entered or selected data inside a field. |
| **Choice chip** | One of a mutually exclusive set, shown as chips. |
| **Pill** | A shape. Never a sufficient name. |

## Feedback and messaging

| Name | Behaviour |
|---|---|
| **Toast** | Transient system feedback; disappears on its own. |
| **Snackbar** | Transient feedback with at most one contextual action. |
| **Undo toast** | Snackbar whose action reverses the completed change within its lifetime. |
| **Inline message** | Placed beside the content it concerns; persists. |
| **Callout** | Inset block that draws attention to nearby content. |
| **Banner** | Broad, persistent page- or section-level message. |
| **Alert** | Important message requiring timely perception. |
| **Notification** | Event message, possibly persistent, often collected in a centre. |
| **Unsaved-changes indicator** | Shows dirty state; decide whether leaving warns. |
| **Connection banner** | Shows offline or reconnecting; says what still works. |

A toast is never the only proof that important work succeeded. Success shows in the resulting state.
Important failure and its retry outlive transient feedback.

## Validation timing

| Name | Behaviour |
|---|---|
| **On submit** | Errors appear after the committing action, with an error summary linking to fields. |
| **On blur** | A field validates when focus leaves it. |
| **Real-time** | Validates on each keystroke; reserve for positive guidance such as password strength. |
| **Reward early, punish late** | Success shows as soon as the value is valid; errors wait for blur or submit. |
| **Server-side** | The result arrives after a round trip; decide the pending state and where the error lands. |

An error clears when the value becomes valid by any path: typed, restored, prefilled, or corrected.

## Loading and progress

| Name | Behaviour |
|---|---|
| **Spinner** | Work is happening; structure and duration unknown. |
| **Skeleton** | Placeholder approximating the eventual structure, so geometry survives. |
| **Determinate progress** | Completion proportion known. |
| **Indeterminate progress** | Active, proportion unknown. |
| **Buffering indicator** | Waiting for enough buffered media. |
| **Optimistic UI** | Shows the expected result immediately; decide the rollback presentation. |
| **Save indicator** | Shows saving, saved, or failed for background persistence. |
| **Stale-data indicator** | Content is visible but may be outdated; decide the refresh path. |

A spinner where a skeleton belongs is how a page arrives and then rearranges itself.

## Pagination

| Name | Behaviour |
|---|---|
| **Pagination** | Discrete pages with explicit navigation; a page is addressable. |
| **Cursor pagination** | Continuation cursors; no page numbers, no jumping. |
| **Load more** | An explicit action appends a batch. |
| **Infinite scroll** | Loads automatically near the scroll boundary; decide how the footer stays reachable. |

## Empty and blocked states

Each needs different copy and a different action.

| Name | Behaviour |
|---|---|
| **First-use state** / zero-data | Nothing exists yet; teaches the first action. |
| **Zero-results state** | A query or filter matched nothing; offers to relax the criteria. |
| **Error state** | Loading failed; retry lives here. |
| **Offline state** | No connectivity; says what still works. |
| **Permission-denied state** | The user may not see this; says who can and how to ask. |
| **Unavailable state** | The service is down; sets an expectation. |
| **Deleted** / archived state | The object existed and is gone; offers restore when possible. |

## Named states

States whose name carries a rule.

| Name | Behaviour |
|---|---|
| **Pristine** / dirty | Dirty means the user changed something not yet persisted; gates leave warnings. |
| **Touched** | The field received and lost focus; gates on-blur validation. |
| **Pending** | A request is in flight; the affected action is locked or optimistic. |
| **Optimistic** / confirmed / rolled back | A result shown before confirmation, then settled either way. |
| **Stale** | Data may be outdated; decide the indicator and refresh path. |
| **Superseded** | A later request replaced this one; its result is discarded on arrival. |
| **Conflict** | Another writer changed the object; decide merge, overwrite, or reload. |
| **Mixed** / indeterminate | A parent whose children are partly selected. |
| **Expired** | Session or offer no longer valid; decide what input survives re-authentication. |
| **Rate-limited** / timed out | Failed for a temporary reason; retry after a wait. |
| **Reconnecting** | Connectivity is being restored; decide whether queued actions are visible. |
