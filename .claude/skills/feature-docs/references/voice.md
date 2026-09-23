# Voice and structure of docs/features

The pages read as a product reference: plain, direct, scannable. A manager should find
what a setting does in a few seconds. Match what is there. When in doubt, open a
neighbouring page and copy its shape.

## Page shape

```markdown
# <Feature Name>

<One or two sentences: what the feature is and why it matters.>

---

## Overview
- <What it lets you do, as short bullets>

---

## <Task or Area>

### <Sub-task>
1. <Numbered steps for procedures>
2. ...

### <Another aspect>
- <Bullets for facts and rules>

---

## Tips

- <Practical advice, one line each>
```

- `---` separates every `##` section.
- The title is the feature name in Title Case, never "X: explainer".
- `##` and `###` headings are in Title Case and name a task or area ("Opening a Shift",
  "Change Comes Only from Cash"), not a question.
- Every page ends with **Tips**. Pages 26–28 also use a **Setup** style with tables of
  settings. Follow the page you are on.

## Sentences

- **Second person, present tense.** "Click **Hold** to save the order." "You are
  redirected to the POS view." Not "the user will be redirected".
- **Short bullets, one fact each.** Most bullets are a single clause. No closing
  full stop on fragment bullets. The existing pages mostly leave it off. Follow the page.
- **Bold for anything on screen or in ERPNext**: buttons, dialogs, fields, settings,
  permissions, menu items. **Close Shift**, **Applicable for Users**, **Change Price**.
- **Backticks for** keys (`Ctrl+R`, `F2`), field names when the page already uses them
  (`allow_rate_change`), and literal codes.
- **Quote messages the user sees** exactly, in quotes or italics as the page does:
  *"A card payment cannot be more than the amount due …"*.
- **Em dash for label-then-explanation bullets**: `- **Hide** (default) — Taken out of
  the menus`. This is the house pattern for definitions.
- No marketing language. Some older pages open with "comprehensive" or "sophisticated".
  Don't add more of it.

## Tables

Settings, permissions, fields and comparisons go in tables:

```markdown
| Setting | Description |
|---|---|
| Allow Rate Change | Allow editing item rates in the cart. Off: … On: … |
```

- Use the label exactly as ERPNext shows it, from the code, not a paraphrase.
- For an on/off setting whose two states matter, write "Off: …. On: …." in the
  description, or use an `Off | On` table.
- Put the default in the description: "(default on)".

## Web POS and desktop till

The docs were written for the web POS. The desktop till shares its screens but differs in
places. Keep the two apart:

- Behavior only on the till goes in a subsection such as `### On the Desktop Till`, or a
  bullet that starts "On the desktop till, …".
- Behavior only on the web POS: "On the web POS, …".
- Link to the till's own page (today `[Desktop Till](29-desktop-till.md)`) the first time a
  page mentions the till. Check the page exists first. If the feature has no page yet,
  say "desktop till" without a link, or add the page when the changes justify one.
- Where the two differ in several ways, add a `| Feature | Web POS | Desktop Till |` table.

## Cross-links

- Link to other feature pages by their title: `see [Cash Movements](14-cash-movements.md)`.
- Link to the page that owns a concept rather than re-explaining it. For example, point
  permission details to the cashier-rights page (today `30-cashier-rights-approval.md`)
  instead of listing the approver rules again. Page numbers here are examples. `ls
  docs/features` shows what actually exists.

## Examples that match the voice

Good:

```markdown
### Lockout
- **Five wrong PINs** lock that cashier out of PIN sign-in for **five minutes**
- A correct PIN resets the count
- Wrong PINs are recorded in the [Audit Log](31-audit-log.md)
```

Not in the voice (developer register, internal detail, no reader action):

```markdown
### Lockout
The main process checks PINs via checkTillPin (scrypt, per-PIN salt). After 5 failures
pin_locked_until is set to now + 300 s (K6).
```

Implementation details (function names, table columns, ticket codes) belong in commit
messages, not here. Mention an implementation fact only when the reader can see it or
act on it, for example "The PIN is stored only as a hash".
