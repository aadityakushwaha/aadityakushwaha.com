---
layout: ../../layouts/Post.astro
title: "The backup that failed in ninety milliseconds"
description: "Three weeks of nightly backups, every one an instant failure, every one recorded and never surfaced. Found the same afternoon as a dual-WAN link that had been down long enough to stop being redundancy."
date: 2026-08-17
status: "8 min read"
kicker: "Audit — self-hosted infrastructure"
hero: "/img/backup-hero.webp"
figure: "/img/backup-fig.webp"
figureAlt: "Two identically configured jobs. One completes; one stops at the first step."
panels:
  - label: "Recorded runs, all failed"
    value: "11"
  - label: "Time each run took to fail"
    value: "91ms"
  - label: "Error messages surfaced"
    value: "0"
  - label: "WAN links actually carrying traffic"
    value: "1 of 2"
---

I went looking for something else and found that a database had no backups at all.

Not "the backups were corrupt". Not "the restore didn't work". The job ran at 03:00 every night, on schedule, and failed **ninety-one milliseconds later**. Every retained record — three weeks of them, 27 July through this morning — says `error`. The failure was recorded each time. Nothing told me.

## What the record looked like

Two Postgres services on the same host, both with a nightly backup on `0 3 * * *`, both writing to the same S3-compatible bucket, both keeping the last fourteen copies. Identical configuration in every field I could see.

One had a clean run of `done`. The other:

| Date | Status | Started | Finished |
|---|---|---|---|
| 2026-08-17 | error | 03:00:00.163 | 03:00:00.286 |
| 2026-08-05 | error | 03:00:00.090 | 03:00:00.277 |
| 2026-08-04 | error | 03:00:00.038 | 03:00:00.173 |
| 2026-08-03 | error | 03:00:00.049 | 03:00:00.140 |
| … | error | | |
| 2026-07-27 | error | 03:00:00.023 | 03:00:00.117 |

Every row `error`. Every row about a tenth of a second long. And every row with `errorMessage: null` — the field exists, the field is empty, the reason lives only in a log file on disk that nothing reads.

The duration is the tell. A real backup of a real database takes seconds at minimum; the successful job next to it takes about 220ms for a small one. Ninety milliseconds is not a backup that went wrong partway through. It is a backup that never started.

## The cause, which is embarrassing

The log said it in one line:

```
pg_dump: error: connection to server at "localhost" (::1), port 5432 failed:
FATAL:  database "console-db" does not exist
```

`console-db` is the name of the **service**. The database inside it is called `console`. When the backup was configured, the service name went into the database field, and `pg_dump` was asked every night for three weeks to dump a database that has never existed.

The working service next to it doesn't have the bug for no better reason than that its service name and its database name happen to be the same word.

That is a one-field fix. It is not the interesting part.

## The interesting part is that nothing told me

Every layer here did its job:

- the scheduler ran on time, every night
- the runner executed the command and captured the failure
- the failure was written to the deployment record with `status: error`
- the log was saved, with a perfectly clear message in it

And the aggregate effect of all that correct behaviour was three weeks of no backups and no signal. The information was *recorded* everywhere and *surfaced* nowhere.

> A backup system tells you when a backup fails. What you actually need to know is when a backup last **succeeded** — and no failure notification can answer that question, because the failure mode you fear most is the one where nothing runs at all.

The monitoring I had was, in effect, "alert me if a backup fails". Even implemented perfectly that is the wrong question, because it is satisfied by silence, and silence is also what a deleted cron job produces. The right question is a freshness check, and it is *not* a check on the backup system:

- for each database that matters, when did an artefact last land in the bucket?
- is that timestamp inside the window we promised ourselves?
- separately: has anything ever been restored from it?

The first two would have caught this on 28 July. The third is the one almost nobody does, and it is the only one that distinguishes "a file exists" from "we can get the data back". Fourteen retained copies of nothing is a number that looks reassuring on a dashboard.

## The same afternoon, the other half of the same mistake

While I was in there, the firewall's gateway status:

| Gateway | Loss | Status |
|---|---|---|
| `WAN_GW` | 0.0% | Online |
| `GW_HOME` | 100.0% | Offline |

Two WAN links, one of them at total packet loss. The estate has been running on a single uplink for long enough that I cannot say when it stopped being two, because everything kept working — which is exactly what a correctly configured failover looks like from the inside.

Dual-WAN is only redundancy while both links work. The moment one is down, you have a single point of failure *plus* a configuration that says you don't. That is worse than knowingly running one link, because it buys a confidence you haven't got.

Both findings are the same shape:

- a safety mechanism that is only exercised when something has already gone wrong
- no routine signal that it still works
- an outcome — quiet nights, working internet — that is identical whether it's healthy or dead

## What I changed my mind about

I used to think the discipline was "set up backups and monitoring". After this afternoon I think the discipline is narrower and more annoying:

**1. Monitor the artefact, not the job.** The job's own report is downstream of the job running at all. Check the bucket for a recent object, from outside the system that writes it.

**2. Alert on staleness, not on failure.** "No successful backup in 26 hours" catches failures, silent failures, disabled schedules, deleted jobs and dead hosts with one rule. "A backup failed" catches one of those five.

**3. Read the error field when you build the alert.** Here the failure record's `errorMessage` was `null` while the real reason sat in a log file — so an alert built off that record would have paged me with no reason attached. Worth knowing before 3am, not during.

**4. Exercise the failover on purpose.** A link that fails over silently, and a backup that restores untested, are the same bet: that the first time you need it will also be the first time you use it.

**5. Duration is a signal.** A job that has always taken 90ms was never doing the thing. It didn't need a human to read the logs — a rule as dumb as "a database backup that finishes in under a second is a failure" would have caught this on night one.

The one-field fix takes a minute. The freshness check is the actual work, and I'd rather have it than a hundred correctly-recorded errors nobody reads.
