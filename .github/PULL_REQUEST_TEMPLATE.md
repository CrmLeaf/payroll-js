<!--
    Thanks for this. Two things worth knowing before you fill it in:

    A change to a rate table or a published figure is also carried across to a
    TypeScript port that has to agree with this package to the paisa. A
    maintainer does that when merging - you do not need to - but it is why those
    pull requests take a little longer to land.

    If your change corrects a statutory figure, the citation is the part that
    matters most. Everything else can be fixed in review; a figure without a
    source cannot be checked at all.
-->

## What this changes

<!-- One or two sentences. Link the issue. -->

## Type

- [ ] Bug fix (no change to any published figure)
- [ ] Corrected calculation (**changes output**)
- [ ] Statutory rate change (**changes output**)
- [ ] New calculator
- [ ] Documentation or chore

## Checklist

- [ ] A test covers this, and it fails without the change
- [ ] `composer check` passes
- [ ] `CHANGELOG.md` updated
- [ ] No credential, token or key is committed

## If this changes a published figure

- [ ] The rate table entry is **added with a new `effective_from`**, not edited
- [ ] The `source` field cites the notification, circular or Act section
- [ ] A test pins the **new** behaviour, and another proves the **old** behaviour
      still holds for earlier dates
- [ ] The TypeScript port is updated in the monorepo, or parity fails

**Statutory basis:**

**Worked example** — inputs to output, before and after:
