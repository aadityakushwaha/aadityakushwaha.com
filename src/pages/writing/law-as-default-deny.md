---
layout: ../../layouts/Post.astro
title: "Encoding the law as a default-deny"
description: "Cold email is regulated differently in every country, and the regimes disagree. Putting that in a wiki page produces confident guessing. Putting it in a function produces a verdict, a citation, and a diff."
date: 2026-08-17
status: "9 min read"
kicker: "Design — outbound compliance"
hero: "/img/gate-hero.webp"
figure: "/img/gate-fig.webp"
figureAlt: "Most of the map is unverified. Unverified is held, not sent."
panels:
  - label: "Companies in the pipeline"
    value: "233,421"
  - label: "Carrying a personal address"
    value: "53,404"
  - label: "Carrying a role mailbox"
    value: "2,356"
  - label: "Countries verified lawful"
    value: "6"
---

Every outbound system eventually meets the same question: may we email this person? The usual answer is a wiki page, a paragraph in an onboarding doc, and an operator making a judgement call at three in the afternoon with a list of ten thousand rows in front of them.

That arrangement fails in a specific way. It does not produce wrong answers so much as *unrecorded* ones. Six months later nobody can say why a particular company was mailed, and "it seemed fine" is not a defence anyone wants to give a regulator.

So the gate is a function. It takes a recipient, it returns a verdict and the basis for it, and its default is **hold**.

```ts
export type Verdict = "send" | "hold" | "block";

export interface GateResult {
  verdict: Verdict;
  basis: string;
}
```

## Three verdicts, because two would lie

A boolean forces every unknown into one of the two answers, and both are wrong. `false` for an unverified country means a lawful market is silently dark forever. `true` means you're sending on a basis nobody has checked.

The third verdict is the useful one. `hold` says: this may well be fine, and no human has established that yet. It queues, it doesn't send, and it is visibly distinct in the UI from `blocked`, because they mean opposite things — one is "not yet", the other is "no".

The critical consequence is that **"not on the blocked list" carries no information**. ePrivacy Art 13(5) left the treatment of legal persons to member states, and they diverged sharply. The UK exempts corporate subscribers; Germany requires prior consent from everyone. A list of countries where cold email is prohibited is not the complement of a list of countries where it is permitted, and a system built on that assumption is one unfamiliar ISO code away from sending into a jurisdiction it has never considered.

```ts
const cleared = CLEARED[country];
if (!cleared) {
  return {
    verdict: "hold",
    basis: `${country} not verified — ePrivacy Art 13(5) left legal-person treatment to member states and they diverged; unverified is not cleared`,
  };
}
```

## The basis is the point

Each entry carries the statute that justifies it. Not a category — the citation:

```ts
const BLOCKED: Record<string, string> = {
  DE: "UWG s.7(2) no.2 — prior express consent required from all market participants, no B2B carve-out; any competitor has standing and Abmahnung costs are recoverable",
  AT: "TKG s.174(3) — no person-type carve-out; s.174(6) deems an offence committed abroad to occur where the message reaches the recipient",
  ES: "LSSI Art 21 — flat prohibition, and 'destinatarios' covers legal persons",
  SA: "PDPL Art 25 + IR Art 28 — consent required absent prior interaction, expressly reaches parties outside the Kingdom",
};
```

Germany is instructive about why the reason matters more than the verdict. It is not blocked because the fine is large — it is blocked because *any competitor has standing*, and the enforcement mechanism is a cheap, routine cease-and-desist whose costs you pay. That is a completely different risk shape from a regulator who might one day investigate, and you cannot see it in a boolean.

The cleared side reads the same way:

```ts
const CLEARED: Record<string, string> = {
  US: "CAN-SPAM — opt-out regime; requires solicitation labelling, a working opt-out and a valid physical postal address",
  GB: "PECR reg 22 — the electronic-mail rule does not apply to corporate subscribers",
  IE: "S.I. 336/2011 reg 13(2) — express business carve-out",
  FR: "CNIL — professionals get an opt-out, not an opt-in, provided the message relates to their job function",
  ...
};
```

`basis` is returned with every verdict and stored with every send. When someone asks why we mailed a company, the answer is a statute reference attached to that specific message, not a reconstruction.

## Why this is code and not configuration

The obvious refactor is to move the country table into the database and give operators a screen. We deliberately didn't.

This is law, not settings. It changes when a statute changes, which is rarely and on the record. It should move through code review, because the review *is* the process by which a legal claim gets a second reader. And a typo in an admin form must never be able to open Germany.

The same rule needs to exist in SQL — a list view can't call a TypeScript function per row across a quarter of a million records — so the country sets are exported and the SQL predicate is built from them. Two hand-maintained copies of a legal rule is a defect waiting to happen; one source with two renderings is merely something to keep an eye on.

## Corporate or individual, and the answer when you can't tell

In the UK, Ireland and France the whole question turns on whether the subscriber is a business or a person. A sole trader is an individual subscriber under PECR and gets the individual regime; a limited company does not.

```ts
const ENTITY_SENSITIVE = new Set(["GB", "IE", "FR"]);
```

The US is not in that set, and it's worth understanding why: CAN-SPAM applies the same opt-out regime to everybody, so entity type doesn't change the answer. Encoding "which countries care about this distinction" is itself a piece of the law.

Then the case that actually dominates real data — you don't know:

```ts
// ICO is explicit: where you cannot tell whether a subscriber is corporate or
// individual, treat them as an individual.
return {
  verdict: "hold",
  basis: `${country}: entity type unknown — ICO guidance is to treat an unidentifiable subscriber as an individual`,
};
```

A related boundary decides whether an address is personal data at all: a role mailbox — `info@`, `sales@`, `careers@` — is the company's, not a person's. The test has to be narrow, because getting it wrong in the permissive direction puts a founder's Gmail in the column the send path trusts. So it is a known role local-part **on the company's own verified domain**, and nothing else. `info@gmail.com` is somebody's inbox. `info@someagency.in` is somebody else's company.

## Suppression fails closed

Do-not-contact is the one rule that is mandatory in every geography, and it has two properties that are easy to get wrong.

**It attaches at the domain, not the address.** Once an objection under GDPR Art 21(2) lands, targeting a different named person at the same firm is the same violation wearing a different address. So suppression can be recorded at domain scope and every address underneath it stops.

**An address we cannot parse is an address we cannot check, so it is blocked.** The cost of a false block is one lost send. The cost of a false pass is a complaint, and Google's spam-rate threshold is 3 per 1,000 — a few false passes are not a compliance problem, they are a deliverability problem that takes the whole domain down with it.

And it is checked at *send* time, never at list-build time. A list built on Monday and sent on Thursday carries three days of un-honoured opt-outs.

## The entry I'm least comfortable with

India clears, on the DPDP s.3(c)(ii) self-published carve-out, applied to addresses filed with the MCA and republished by the Registrar. The gate says so, in the basis string, including the weakness:

> The carve-out exempts data the Data Principal **themselves** made public, and a statutory filing is the weakest form of that claim.

Which is true. A director's email reaches the register because the Act requires it, not because they volunteered it, and it is republished by the Registrar rather than by the person. The gate narrows `send` to corporate bodies, which does real work — but of 233,421 companies in the pipeline, **53,404** carry an address our own data marks as personal, against **2,356** unambiguous role mailboxes. The uncontroversial set is small.

What made this get re-read wasn't the legal argument, which had been weighed once and written down. It was a change in *presentation*. A market-validation tool started answering questions like "will this product sell" with, among other things, "all 25 are mailable" — twenty-five named companies, mid-answer, next to a market verdict, in response to a question about product-market fit. Same verdict, same code, completely different risk surface: a green light arriving unrequested rather than a filtered list someone deliberately built.

That is the argument for this whole design, better than anything I could construct. The rule was legible enough that a change in how it surfaced could be recognised as a change in exposure, written up with the numbers attached, and put in front of a person to decide. A wiki page cannot be reviewed like that, and a boolean has nothing to review.

The gate is not right because the law is settled — it isn't, in half these jurisdictions. It's right because when it is wrong, that's a diff.
