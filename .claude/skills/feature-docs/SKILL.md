---
name: feature-docs
description: Bring the X POS feature documentation (docs/features/) up to date with code changes, in the voice the pages already use. Works out which commits are not yet documented, maps each to the feature page it affects, checks labels and behavior against the code, updates existing pages, and adds new numbered pages when a feature has none. Use whenever the user asks to update, sync, refresh or write the feature docs, document a release, a feature or a branch's changes, check whether the docs are current, or says "we changed X, the docs don't say so", even if they don't name docs/features.
---

# Feature docs

`docs/features/` is the user-facing reference for X POS: one numbered page per feature
area, indexed in `00-overview.md`. The readers are shop managers, supervisors and the
people setting up ERPNext, not developers. The docs describe what someone sees and does
at the POS, and what each setting in ERPNext changes.

The job: find what changed in the code since the docs were last brought up to date, and
make the pages say it, in the voice the pages already use. Read
[references/voice.md](references/voice.md) before writing anything. Matching the voice
is part of the job, not a finishing touch: a page that suddenly reads differently from
its neighbours looks unreliable.

This repository is a **public** fork. Never put client names, hostnames, account IDs or
internal ticket names in the docs.

**Describe what the system does, never where it is weak.** The guide is also shown in the
app, to cashiers, and the fork is public. A sentence like "no screen checks this yet", "the
web POS does not ask for approval" or "lowering a quantity needs no manager" is a map for
getting round a control. When a control has a gap, leave the gap out: say what the
control does, and mark an unenforced permission as coming (or leave it out) rather than
unchecked. Tell the user about the gap in your report so it goes to the private plan, where
known gaps are tracked. Saying that an action is recorded and reviewed is fine: that
deters. Commit messages mention decision codes (K19, D7) and
bug-hunt dates. Those stay out of the docs too; describe the behavior instead.

## 1. Find what is undocumented

`docs/features/.documented-through` holds the last commit the docs were brought up to
date with. Everything after it is a candidate:

```bash
BASE=$(cat docs/features/.documented-through)
git log --reverse --no-merges --format='=== %h %s%n%b' "$BASE"..HEAD > "$SCRATCH/commits.txt"
git diff --stat "$BASE"..HEAD -- . ':!**/tests/**' ':!**/test_*'
```

If the user names a range, a release (`v2.9.0-offline.10..v2.9.0-offline.11`) or a
feature, use that instead. If the marker file is missing, use the last commit that
touched `docs/features/`, and say which you used.

Read **every commit message in full**. In this repo the commit bodies explain the
behavior in plain terms, and they are the fastest route to what changed. Then sort the
commits:

- **Document**: anything a cashier, manager or administrator would notice. New
  screens, settings, permissions, fields on ERPNext doctypes, changed rules (what is
  blocked, flagged or asks for approval), messages the user now sees, offline and sync
  behavior, printing.
- **Usually skip**: tests, CI, refactors, the bug-hunt tooling, and fixes that only make
  something work the way the docs already say it works. A fix that changes what the docs
  promised is not a skip. Correct the page.

## 2. Map commits to pages

List the pages (`ls docs/features`) and their headings (`grep -n '^#' docs/features/*.md`).
For each documentable change, decide:

- **Which existing page it belongs on.** Most changes land on several pages. For
  example, a new permission touches the page for the feature it gates, the POS Profile
  config page (`24`) if it adds a setting, and the shortcuts page (`25`) if it adds a
  shortcut.
- **Whether it needs a new page.** Add one only for a feature area that has no home.
  Number it after the highest existing page, add it to the index table in
  `00-overview.md`, and link to it from the pages that mention it.

Read each page you will change **in full** before editing. You are adding to a document
someone else wrote, and you need its structure and its existing claims in your head.

## 3. Check facts against the code, not the commit message

Commit messages say what was intended. The docs must say what the code does. Before you
name anything, look it up:

| What | Where to look |
|---|---|
| POS Profile, POS Profile User, Sales Invoice custom fields: labels, defaults, descriptions | `xpos/x_pos/custom/*.json` |
| X POS doctypes: fields, select options | `xpos/x_pos/doctype/<name>/<name>.json` |
| POS Role permissions: labels and groups | `xpos/x_pos/doctype/pos_role/pos_role.js`; keys in `xpos/api/auth.py` |
| Menu items and shortcuts | `frontend/src/components/MenuBar.vue`, `frontend/src/components/items/CommandSearch.vue` |
| Text the user sees | `grep -rn` the message in `frontend/src` |
| Desktop-only behavior | `frontend/electron/` and `isElectron()` checks in `frontend/src` |

A quick way to list custom fields added since a commit:

```bash
python3 - "$BASE" <<'EOF'
import json, subprocess, sys, glob
for f in glob.glob("xpos/x_pos/custom/*.json"):
    old = subprocess.run(["git", "show", f"{sys.argv[1]}:{f}"], capture_output=True, text=True).stdout
    known = {c["fieldname"] for c in json.loads(old or '{"custom_fields":[]}').get("custom_fields", [])}
    for c in json.load(open(f)).get("custom_fields", []):
        if c["fieldname"] not in known:
            print(f, "|", c["fieldname"], "|", c.get("label"), "|", c.get("fieldtype"), "| default", c.get("default"))
EOF
```

Things that went wrong before and are worth checking every time:

- **Defined but not enforced.** A permission or event type can exist in the catalog
  with nothing checking it yet. Grep for where it is used. If only the catalog, the
  migration and the sync mention it, call it coming, or leave it out. Don't describe it
  as working, and don't say that nothing checks it (see the rule on gaps above).
- **Web POS vs desktop till.** Many changes apply to only one. Check for `isElectron()`
  or code under `frontend/electron/`. Say which one a behavior belongs to. Don't write
  "the POS does X" when only the till does.
- **Stale claims nearby.** While on a page, check the claims around your edit against
  the code. Fields get removed and rules change. Fix what is wrong, and tell the user
  what you corrected.
- **Settings tables name real fields.** Every row on the POS Profile page (`24`) must
  use the label ERPNext shows, not a paraphrase and not a field that has since been
  removed or moved to **POS Settings**. Older rows drifted this way unnoticed.
  `scripts/check_settings.py` checks every row, not only the ones you touched.
- **Defaults and upgrades.** When a setting's default changed, or a patch switches it
  for existing sites, say so. That is what an administrator needs to know on upgrade.

## 4. Write

Follow [references/voice.md](references/voice.md). In short: add to the existing
structure rather than rewriting it. Put till-only behavior in its own subsection
("On the Desktop Till", "… on the Desktop Till") or a clearly marked bullet. Keep each
page's closing **Tips** section, and add a tip when the change gives the reader
something to do.

**Mark who a section is for.** The app shows the guide by role. A section for supervisors
or administrators carries a marker on the line after its heading, `<!-- audience:
supervisor -->` or `<!-- audience: administrator -->`; under the page's title it sets the
whole page, and a section without one takes its parent's. Unmarked means cashier. Setup in
ERPNext (POS Profile fields, roles, accounts, installing the till, print formats) is
administrator; reviewing, approving and reconciling (the audit log, cashier rights, tax and
accounting detail) is supervisor; what happens at the till is cashier. A section a "?" in
the app opens must stay readable by the people on that screen (`TOPIC_AUDIENCE` in
`frontend/src/help/helpLinks.ts`; `tests/helpGuide.spec.ts` checks it).

**Headings are link targets.** Other pages link to them (`30-cashier-rights-approval.md#manager-approval-on-the-till`),
and the app will open the guide at them. Renaming or removing a heading silently breaks
every link to it. Keep existing `##` and `###` headings as they are, and add new ones
beside them. When one truly has to change, grep for its anchor (`grep -rn '#<slug>'
docs/ frontend/src`) and update every link. Anchors are GitHub-style: lower case,
spaces become `-`, punctuation dropped.

Prefer `Edit` for single changes. For many insertions across a page, a short Python
replace script that asserts each anchor exists is faster and fails loudly when an
anchor has moved.

## 5. Check and finish

```bash
# every link between pages resolves, anchors included
python3 .claude/skills/feature-docs/scripts/check_links.py
# every row in the POS Profile settings tables is a real field label
python3 .claude/skills/feature-docs/scripts/check_settings.py
```

- Reread each new page once with the voice reference beside it.
- If `docs/features/translations/<lang>/` exists, list the translated pages whose English
  page you changed. Translations are keyed to the English headings and fall behind
  silently. Report them as needing an update. Don't translate unless asked.
- Grep your changes for client names and internal codes (`K[0-9]`, `D[0-9]`, dates of
  bug hunts). None should appear.
- Write the new baseline: `git rev-parse --short HEAD > docs/features/.documented-through`.
  Do this only when you documented the whole range up to HEAD. If you covered only part
  of it, leave the marker and say what is still undocumented.
- Do not commit unless asked. When asked, use a `docs(features): …` message with no
  attribution lines.

Report back briefly:
- Control gaps you found and left out of the docs, for the private plan
- The new pages, one line each
- The pages you updated, grouped by what changed
- Stale claims you corrected
- Anything documented as reserved or not yet working
- Anything you left out on purpose, and why
