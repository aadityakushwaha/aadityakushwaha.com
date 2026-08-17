---
layout: ../../layouts/Post.astro
title: "Two ways a parser lies about being right"
description: "A fabricated zero reads as a correct extraction. So does an accuracy score measured on the fields you matched rows by. Both make the number go up."
date: 2026-08-17
status: "9 min read"
kicker: "Design — document extraction"
hero: "/img/money-hero.png"
figure: "/img/money-fig.png"
figureAlt: "Phase one matches on the key. Phase two recovers the rows whose key was misread."
panels:
  - label: "States a money cell can be in"
    value: "3"
  - label: "Float types allowed in a money path"
    value: "0"
  - label: "Alignment phases before scoring"
    value: "2"
  - label: "Metrics reported as raw counts"
    value: "all"
---

A document parser's job is to turn printed pages into rows, and its hardest problem is not reading the page. It is knowing whether it read the page correctly — and there are two places where a wrong answer will quietly score as a right one.

This is a Rust parser for insurance loss runs: PDFs from many carriers, each with its own table layout, turned into a canonical row per claim. Money in, money out. Both failure modes below made the accuracy number go *up*.

## One: a fabricated zero

The obvious model for a money column is `f64`, or `i64`, or at best `Option<f64>`. Every one of those is a trap, and they are different traps.

**Floats are the easy one.** No `f32` or `f64` anywhere in the money path. Parse through `rust_decimal`, store `i64` cents. A float in a money type is a review rejection, not a discussion. And Rust's `Decimal::round()` is banker's rounding — round-half-to-even — which is correct for statistics and wrong for a ledger, so the parse goes through an explicit strategy:

```rust
.round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero)
```

That is the sort of default that never shows up in testing, because the only inputs that expose it are exact half-cents.

**The harder one is what "empty" means.** A blank cell in a loss run might mean the carrier is telling you there was no expense reserve. It might mean the carrier does not print that column. It might mean the OCR ate it. Collapse all three to `0` and you have invented data — and the invented data is *plausible*, which is exactly why nobody catches it.

So a parsed cell is three-way:

```rust
pub enum MoneyCell {
    Value(i64),
    /// Empty or a dash: the carrier printed nothing here.
    Blank,
    /// There is content, and it is not money we can read. Never treat as zero.
    Unparsable,
}
```

`Blank` and `Unparsable` are different facts, and neither of them is zero. Only a carrier whose profile explicitly sets `blank_is_zero` — because we have confirmed that this carrier prints blanks where it means nothing — turns a blank into `Some(0)`. The generic profile does not, and there is a test asserting it does not.

Downstream, money fields are `Option<i64>` cents, where `None` means **unknown**. That distinction does two jobs:

- It stops a fabricated zero from corrupting the incurred identity check — the arithmetic relation between paid, reserve and incurred that we use to catch misreads. Feed it a zero you made up and it either fails for the wrong reason or, worse, passes.
- It stops a fabricated zero from *scoring as a correct read*. If truth says the cell was blank and the parser says `0`, a naïve comparator that treats both as zero calls that a hit.

> A wrong value gets caught by anyone reading the output. A confidently invented zero gets caught by nobody, because it looks exactly like the answer.

## Two: scoring the field you matched on

Now the subtler one, and the one I've seen in more places than parsers.

To score an extraction you have to line predicted rows up against ground-truth rows. The natural key is `(claim_number, date_of_loss)` — it's what identifies a claim.

Then you compute per-field accuracy across the aligned pairs. And `claim_number` comes out at 1.0. Every time. On every carrier. Including the ones with terrible scans.

Of course it does: **you only aligned the rows where the claim number matched.** Its accuracy is 1.0 by construction, and it will stay 1.0 no matter how badly the parser degrades. Worse than the useless metric is what happens to the rows you got *wrong*: a row whose claim number was misread never matches anything, so it never becomes a pair, so it silently leaves the denominator. Misreading a key doesn't lower the score — it removes the evidence.

The fix is a second alignment phase:

```rust
// Phase 1: exact key match.
for truth_row in truth { /* find the unused predicted row with the same key */ }

// Phase 2: recover rows whose key was misread, by loss date + incurred amount.
```

Rows that phase one couldn't pair are recovered by a *different* signal — the loss date and the incurred amount — so the pair exists, and the claim number in that pair is then scored as what it is: **wrong**. The metric can finally move.

The general rule, and it applies far outside document parsing:

**Never evaluate a field on a set you selected using that field.** Retrieval evaluated only on retrieved documents. Deduplication accuracy measured on the records the deduper decided were the same. Any join-then-score pipeline. The alignment stage is part of the measurement, and if it uses the thing being measured, the measurement is circular.

## The third one, since we're here: how the rates are pooled

A related way to be quietly wrong. Run the parser over a corpus of documents and you can report accuracy two ways:

- average the per-document rates, or
- pool the raw counts corpus-wide and divide once.

They are not the same number, and the first one flatters you. A tidy five-row document scores 1.0 and contributes exactly as much to the average as a 400-row scanned monster that scored 0.7. Clean documents dominate, and the average drifts up as you add easy files to the corpus.

So every metric is returned as raw `Counts` alongside the rate, and a corpus run pools the counts and divides at the end. Same data, different arithmetic, and only one of the two answers survives contact with a customer asking "so how accurate is it on *my* files".

## What these have in common

Both the fabricated zero and the self-scoring key are cases where the system produces a **defensible-looking number that no longer measures what it claims to**. Neither is caught by tests that assert the parser returns the right value on a good document, because on a good document everything agrees.

Three habits fall out of that:

1. **Make "I don't know" a value in the type**, not a sentinel that happens to be a legal value in the domain. `Option<i64>` with a documented `None`, and `MoneyCell` with three variants, both exist so that unknown cannot be silently spent as zero.
2. **Check the metric's degenerate case.** If a per-field score is exactly 1.0 across every input, that is not success, it is a construction. Ask what would have to happen for it to be less than 1.0, and if the answer is "nothing", the metric is measuring your alignment code.
3. **Report the counts, not just the rate.** The rate hides both the denominator and how it was chosen — and in both bugs above, the denominator was where the lie lived.

Every row that comes out of this parser carries a `Provenance`, and a row without one is a bug. That is the same principle at the record level: an extracted number is only as trustworthy as your ability to say where it came from — and a number you invented has nowhere to point.
