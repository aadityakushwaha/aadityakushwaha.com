---
layout: ../../layouts/Post.astro
title: "One PDF at a time"
description: "pdfium crashes two ways: one instance per document SIGTRAPs, and concurrent calls from a single instance segfault. The fix is a global mutex, which means the parallelism has to live somewhere else."
date: 2026-08-17
status: "8 min read"
kicker: "Postmortem — document parser"
hero: "/img/pdf-hero.png"
figure: "/img/pdf-fig.png"
figureAlt: "One shared library, one lock, eight threads that have to wait."
panels:
  - label: "pdfium instances per process"
    value: "1"
  - label: "Concurrent pdfium calls allowed"
    value: "1"
  - label: "Threads in the regression test"
    value: "8"
  - label: "Unsafe blocks in the crate"
    value: "0"
---

The parser is Rust, `#![forbid(unsafe_code)]`, and it crashed with SIGTRAP. Then, after the obvious fix, it segfaulted instead.

Neither crash is in Rust. Both are in pdfium — Chrome's PDF library, reached through `pdfium-render`. The forbid attribute is doing exactly what it promises: there is no unsafe code *in this crate*. It says nothing about the C++ library on the other side of the FFI boundary, and that library has two independent threading rules that are not in any signature.

## Crash one: one instance per document

The natural Rust shape is for each document to own its resources:

```rust
struct Pdf { pdfium: Pdfium, /* ... */ }   // one library handle per document
```

That is how you would model almost anything else. It is wrong here, and it does not fail gracefully — it SIGTRAPs the moment two instances exist. pdfium sets up and tears down process-global state per `Pdfium` instance, so a second instance's initialisation walks over the first one's world.

So the handle is a process singleton:

```rust
static PDFIUM: OnceLock<Pdfium> = OnceLock::new();
```

`Pdf` then holds only the document bytes. It is a document that knows how to ask the one library for its pages, rather than a document that owns a library.

## Crash two: one call at a time

With a single shared instance the SIGTRAP goes away, and you get a segfault instead, because pdfium is not safe for concurrent document work *even from one instance*. Two threads calling `extract_pages` on two different documents will eventually corrupt each other.

There is no way to make that safe from the Rust side except by not doing it:

```rust
static PDFIUM_GUARD: Mutex<()> = Mutex::new(());

/// Serializes pdfium access. Recovers from poisoning: the lock protects a C library,
/// not our invariants, so a panicking caller does not corrupt what we guard.
fn pdfium_guard() -> MutexGuard<'static, ()> {
    PDFIUM_GUARD
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
```

Every pdfium call in the process takes that guard. It is a `Mutex<()>` — it guards nothing of ours, it guards *the library*, which is why the poison recovery is correct here and would be suspicious anywhere else. A panic while holding it means a caller's parse blew up; it does not mean pdfium's internal state is now inconsistent in a way that a second caller must be protected from. Poisoning would just convert one failed document into every subsequent document failing.

## The consequence you have to design around

Once that mutex exists, PDF work in a process is strictly serial. No amount of `rayon` or `tokio` changes it — you can spawn eight tasks and they will queue at the lock.

Two things follow, and they're the actual engineering:

**Scale with processes, not threads.** The unit of parallelism for ingestion is the OS process. That is a deployment shape, not a code change, and it needs to be decided early because it determines how work is distributed and how memory is budgeted.

**Keep everything else outside the guard.** Model inference is the expensive part of this pipeline, and it must not run while holding the pdfium lock. The guard covers page extraction and nothing else; the moment the pages are out of pdfium, the lock is released and the slow, parallel-friendly work happens outside it. Get that wrong and you have serialised the whole pipeline behind a library that only needed the first stage.

> The constraint is one call at a time. The design question is how *little* work you can do while holding it.

## The test that has to exist

A constraint you cannot see in a type signature needs a test that fails loudly when someone removes it — and the natural refactor here ("why is this a singleton? why is there a global lock?") is exactly the one a well-meaning reviewer proposes:

```rust
#[test]
fn concurrent_extraction_does_not_crash() {
    let bytes = fixtures::text_pdf("CLAIM 12345 PAID 1,000.00");
    let handles: Vec<_> = (0..8)
        .map(|_| {
            let bytes = bytes.clone();
            std::thread::spawn(move || {
                let pdf = Pdf::from_bytes(&bytes).unwrap();
                let pages = pdf.extract_pages(72, DEFAULT_MIN_TEXT_CHARS).unwrap();
                assert_eq!(pages.len(), 1);
            })
        })
        .collect();
    for handle in handles {
        handle.join().expect("no thread may crash pdfium");
    }
}
```

Eight threads, one document, and an assertion that no thread died. It is not a subtle test. Its whole job is to turn "remove this weird global mutex" from a merge into a red build.

Note the fixture: a hand-built synthetic page, not a real document. The `data/` directory in this repo holds actual client insurance documents and is gitignored, and the rule is absolute — never commit a customer document, a filename, or a carrier-identifying fixture. Which means every test PDF is constructed in code. That is more work up front and it is the only version of this test that can exist in a public repository.

## The unglamorous part: making the library findable

pdfium is a shared library that has to be present at runtime, and the pinned build is a specific tag of `pdfium-binaries` referenced in **two** places — the runbook and the CI workflow — which must agree. A mismatch there is a runtime failure that looks like a code bug.

The search order is: `PDFIUM_LIB_PATH` from the environment, then the vendored directory in the repo, then the working directory. Failure is explicit and tells you what to do:

```
pdfium shared library not found (last error: …);
set PDFIUM_LIB_PATH or run scripts/fetch-pdfium.sh
```

Half the value of an FFI dependency's error handling is in that second line. "Not found" is a puzzle; "not found, run this script" is a task.

## What generalises

An FFI boundary imports the other library's threading model, and that model is not in the signature. `pdfium-render` is safe Rust — safe in the borrow-checker sense — and both crashes above are things the compiler cannot see and will never warn you about.

So the rules that came out of this are:

1. **Assume process-global until proven otherwise.** A C library that initialises "the world" usually means one world per process.
2. **Serialise first, optimise second.** A global lock is a bad performance story and a fine correctness story. Ship the correct one, then move work out from under it.
3. **Write down why the lock recovers from poisoning** — otherwise it reads as sloppiness rather than a deliberate call about what is being protected.
4. **Leave a test whose only purpose is to fail on the obvious refactor.** The constraint is invisible; the test is the only thing that makes it real to the next reader.

`#![forbid(unsafe_code)]` at the top of the crate is still true, and still worth having. It just draws its boundary at the FFI edge, and everything past that edge is somebody else's rules.
