# Extraction rules

    Purpose:    How the knowledge in 11-static-analysis becomes something shippable.
    Depends on: 11-static-analysis
    Decides:    rules as data, the derivation procedure, the scorer, the skill

## Rules are data, not code

A table shipped as JSON, executed by one generic engine:

    { glob, method, pattern, namespace, direction, confidence, vendorHint, provenance }

`method` is the extraction technique — cfg parse, XML node, RPN token, JS call
site, binary string. `provenance` records what derived the rule, against which
aircraft, and at what score.

Why data:

- New addons appear constantly and vendors have house styles. Rules will need
  to grow far more often than the engine will.
- A user can generate rules for addons we do not own.
- Rules can be merged, ranked and pruned without a release.

## Derivation is measured, not judged

The failure mode of "study these files and write rules" is overfitting to one
collection and producing a pile of special cases. The fix is to **build the
answer key before deriving anything.**

Three oracles, in descending strength:

1. **Live `L:` enumeration for an aircraft.** Definitive — that *is* the list.
2. **Names in existing profiles.** Known-real, incomplete.
3. **Spot checks.**

The procedure:

1. Capture an answer key for as many aircraft as possible.
2. Propose extraction rules from reading the files.
3. **Score each rule on recall and precision against the key.**
4. Keep rules that measurably add recall without wrecking precision.
5. Emit the surviving set as data, with scores recorded in `provenance`.

Rules get kept because they earn it, not because they looked sensible. The
scorer doubles as a regression suite: add a rule later, see what moved.

**Ordering consequence.** This is most valuable *after* the module lands, since
that is what supplies the strongest key. Before then the corpus alone can
bootstrap it — real, but weaker. Recall the `Accusim.wasm` result in
[11-static-analysis](11-static-analysis.md): 222 of 3,009 strings confirmed,
which is enough to start and not enough to tune against.

## The skill

The derivation procedure ships as a skill in this repo, so that anyone can run
it against their own Community folder and generate rules for addons we have
never seen.

**The skill must carry the scorer, not just the prompt.** Otherwise a
contributed rule is somebody's guess, and a rules file full of guesses is worse
than a short one. So it ships:

- the extraction engine, so proposed rules can actually be run
- the scorer and the instruction to build an answer key first
- the output format, identical to what the app consumes, so a user's result
  drops straight in
- the requirement that every emitted rule carries its provenance and score

It should be the **only** way rules get made, including by us. If our first
ruleset is hand-derived and the skill is written up afterwards, the two drift.
Our rules file should be the skill's first output.

Keep it in the repo, versioned alongside the format it emits.

## Sharing

Rules are **per-vendor, not per-user**. Someone with Just Flight, Milviz or
Carenado addons we will never own can derive rules that help everyone who owns
them. That argues for an import and merge path eventually, and the existing peer
channel makes sharing a rules file a small step from sharing a profile.

It is also not altruism-only: new addons get bought, and this gets re-run.
