---
layout: ../../layouts/Post.astro
title: "The document your editor quietly rewrote"
description: "Six data-loss bugs in one course editor. Five were about saving. The sixth was the editor deleting content on open, and it is still open."
date: 2026-08-16
status: "11 min read"
kicker: "Audit — course editor"
hero: "/img/doc-hero.webp"
figure: "/img/doc-fig.webp"
figureAlt: "A buffer that flushes, and a buffer whose cleanup cancels it."
panels:
  - label: "Trust findings in the audit"
    value: "10"
  - label: "Shipped"
    value: "8"
  - label: "Root-caused, fix open"
    value: "1"
  - label: "Was never data loss"
    value: "1"
---

An audit of our course editor on 16 August 2026 turned up ten findings under the heading *trust and data loss*. Most of them are the same bug wearing different clothes, and it is a bug almost every rich-text editor on the web has shipped at least once: **the thing you typed is in a buffer, and the buffer is not the document.**

The sixth one is different, and worse, and it is the one I want to get to.

## Five ways to lose the last thing somebody typed

Autosave in this editor is two layers of debounce. The inner one batches keystrokes into a document update; the outer one batches document updates into an API call. Both are the standard pattern, and both were wrong in the same way.

**The debounce cancelled instead of flushing.** React cleanup on unmount called `clearTimeout`. Switching card or lesson remounts the editor — so the last ~500ms of typing, still sitting in the pending timer, died with the component. Not "failed to save": never attempted. The fix is a `flush()` that the unmount path calls instead of `cancel()`.

**The outer layer did the same thing.** The lesson state hook's cleanup cleared its autosave timer without committing it. Two independent buffers, two independent cancel-on-unmount bugs, and one is not visible while you are looking for the other.

**Closing the tab lost whatever was pending.** No `beforeunload`, no `visibilitychange` flush. The pattern already existed elsewhere in the codebase — the SCORM player and the video module both do it. It just hadn't been applied here.

**In-app navigation lost it too.** Every sidebar lesson link and the toolbar's back button were plain `<Link>` elements. The only place in the whole editor that flushed pending work was the *preview* button. So previewing your lesson saved it, and clicking any other link did not.

**A failed save was gone forever.** This one is my favourite, because it looks like careful code:

```js
const doc = pendingDocRef.current;
pendingDocRef.current = null;   // clear before the await
try {
  await save(doc);
} catch (e) {
  // logged, and that's it
}
```

The reference is nulled before the request so that new edits during the flight are tracked separately. Reasonable. But on failure there is nothing left to retry from — the document was in that ref and now it is in nobody's hands. One network blip and the save is permanently lost unless the user happens to type again. Restore the ref on failure, schedule a retry with backoff, and put a **Save failed — Retry** state in the chrome so the loss is at least visible while it is recoverable.

That last part matters more than the retry. An autosave indicator that renders nothing when idle is indistinguishable from an autosave indicator that is broken.

> Every one of these is a cleanup path. Nobody writes a bug into a save function; they write it into the code that runs when the save function is about to stop existing.

## The one that wasn't data loss at all

A separate report: lesson cover images disappearing. It reads exactly like a deletion bug — the hero goes blank and the button flips from "Replace" to "Set cover".

It was never data loss. The lesson had no cover, and never had. The hero was showing the first image found in the document body as a *fallback*, and that walker only recognised two block types. The moment somebody's first block was an `image_text` instead of a plain `image`, the fallback returned null, the hero fell back to its gradient, and the button correctly announced there was no cover — which is indistinguishable, from the outside, from the cover having been deleted.

The fix was to teach the extractor the other block types that contain an image: `image_text`, `labeled_graphic`, `comparison`, `hero_video`. But the lesson is about triage, not extraction. **A fallback that silently changes what it finds produces bug reports about deletion**, and if you go looking for the deletion you will not find it, because it isn't there.

## The one that is real, and still open

Now the bad one.

Hydration is lossy. When the editor loads a stored document, it normalises every block, and normalisation is not neutral:

- a block whose `type` isn't in the current live schema is dropped — `normalizeBlock` returns `null`
- media blocks are stripped to an allowlist of props

The reduced document is then what the editor holds in memory. And the editor autosaves. So the next save — triggered by a keystroke somewhere else entirely, or by any of the flush paths I just spent five findings adding — **persists the reduced version over the original.** Open a lesson containing a block type that was renamed, or a prop that a refactor stopped allowlisting, and the content is gone. Not shown as an error. Not shown at all.

That is a content-destruction bug with a delayed trigger, and it was found by looking for something else.

What has shipped so far is only a dev-only warning naming the dropped block types on load, so the case can be reproduced deliberately instead of discovered in a customer's lesson.

The fix is not obvious, and I want to be honest about why it's still open rather than pretend the write-up ends neatly.

The instinct is: **render unknown blocks read-only and never write them back**. That is probably right, and it means normalisation stops being one function — a render path that preserves everything, and a save path that touches only what changed.

The tempting shortcut is: **only save after a real user edit.** That is not safe. Programmatic inserts — the block library, the slash menu — produce no keyboard event. Gate on keystrokes and those insertions are silently discarded, which converts a rare data-loss bug into a common one. What the gate actually needs is a *provenance* signal: this change came from an edit, of some kind, rather than from hydration. That is a bigger change than it sounds, and it wants its own reproduction before anybody writes it.

So it sits in the file, marked open, with the mechanism written down.

## Two adjacent findings, both about the same instinct

**A rename that didn't cascade.** The sorting block stores correct answers by category *name*, and grades by string equality. Renaming a category rewrote the category list and not the items pointing at it, so every previously-correct answer became wrong. Cascade the rename — and, longer term, stop identifying things by their display text.

**A sandbox that was fine until it wasn't.** Embed blocks framed third-party content with both `allow-scripts` and `allow-same-origin`, which is the classic sandbox-escape pair. The instinct is to drop `allow-same-origin` — but that breaks every real provider embed, because their scripts need their own origin. The pair is only exploitable when the framed URL is **this application's own origin**: then the frame can reach its parent, strip the sandbox attribute and reload itself unsandboxed. So the fix went to the origin boundary instead of the flag — a `safeEmbedUrl()` that rejects same-origin URLs, applied at the two block specs that accept a user-supplied URL. The video block turned out never to have been vulnerable: its iframe only ever receives a provider URL from `toEmbedUrl()`, and the raw URL goes to a `<video src>`.

Both of those are the same instinct as the autosave bugs, pointed at a different target: fix the thing where it is actually decided, not where it happens to show up.

## What I'd take to the next editor

1. **Every buffer needs a flush path for every way it can stop existing** — unmount, in-app navigation, tab close, tab hide. Enumerate them once, wire them all, and test the boring ones.
2. **Never null your only copy before the await.** Restore it on failure or you have converted a retryable error into data loss.
3. **An idle save indicator that shows nothing cannot show that it is broken.**
4. **Hydration must be lossless, or it must not be able to write.** A pipeline that reads a document, reduces it, and then autosaves is a content-deletion feature with extra steps.
5. **A "deleted my content" report might be a fallback that stopped matching.** Check what the UI is *inferring* before you go looking for the delete.

Eight of the ten shipped. One turned out not to be a bug. One is still open, in the file, with its mechanism written down and its wrong fix explained — which is the least I owe the next person who opens it.
