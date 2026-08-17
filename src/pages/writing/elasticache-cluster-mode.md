---
layout: ../../layouts/Post.astro
title: "The outage that taught me ElastiCache cluster mode"
description: "Redis and ElastiCache Serverless are not the same database. Four assumptions broke at once, and the one that took the platform down wasn't a Redis assumption at all."
date: 2026-08-17
status: "9 min read"
kicker: "Postmortem — ride-hailing platform"
hero: "/img/redis-hero.webp"
figure: "/img/redis-fig.webp"
figureAlt: "One worker: the health probe queues behind stalled requests. Two workers: it doesn't."
panels:
  - label: "Consecutive failures to open the breaker"
    value: "5"
  - label: "Breaker recovery window"
    value: "30s"
  - label: "Uvicorn workers, before"
    value: "1"
  - label: "Uvicorn workers, after"
    value: "2"
---

Production went down on 25 March 2026. The application was running, the database was healthy, and the load balancer had removed every target from the pool because none of them would answer `/health`.

The cause was a Redis client talking to something that is not, in several specific ways, Redis. We had moved to **ElastiCache Serverless**, which runs in cluster mode. Locally, and in CI, we ran a standalone Redis container. Every line of code that broke that afternoon passed its tests.

That is the part worth writing down. Three of the four problems below are ordinary — read the docs, fix the call, move on. The fourth is the one that turned a degraded cache into an outage, and it had nothing to do with Redis.

## Cluster mode is a different database

In cluster mode the keyspace is split across 16,384 hash slots, and a command may only touch keys that live in one slot. That single sentence invalidates a surprising amount of ordinary Redis code.

**`KEYS` is blocked.** Not slow — blocked. The replacement is `scan_iter`, which is a cursor, not a snapshot:

```python
# Before — worked locally, rejected in production.
keys = await redis.keys("maps:route:*")

# After — cursored, cluster-safe, and bounded per round trip.
async for key in redis.scan_iter(match="maps:route:*", count=100):
    ...
```

`scan_iter` gives weaker guarantees than `KEYS` ever did: keys added during the scan may or may not appear, and you can see the same key twice. For every use we had — expiring stale route caches, reaping presence keys, clearing an IP blocklist — that is fine. It is worth checking that it is fine rather than assuming, because the two calls look interchangeable and are not.

**`DEL` with more than one key is a gamble.** `delete(a, b, c)` is a single command against three keys, and three keys hash to three slots unless you deliberately arrange otherwise. Cluster mode rejects it with `CROSSSLOT`. The fix is unglamorous:

```python
for uid in notified_uids:
    # Single key per DELETE — cross-slot safe on ElastiCache
    await client.delete(f"pending_ride_notify:{uid}:{transaction_id}")
```

More round trips, and I have not found a case where that mattered. A pipeline still helps if you need the throughput; what you cannot do is put unrelated keys in one command.

**Your job queue may be doing this behind your back.** This is the one you cannot fix by grepping for `KEYS`. We use [arq](https://arq-docs.helpmanual.io/) for deferred work — notification retries, booking expiry. `enqueue_job` writes a job hash, pushes to a queue list and sets a score in a sorted set, and it does it as one multi-key transaction. Those keys are not in the same slot. On cluster mode, enqueuing simply fails.

The fallback we shipped is a plain `LPUSH` to a well-known list the worker also polls:

```python
except ResponseError as e:
    if "CROSSSLOT" in str(e) or "hash to the same slot" in str(e):
        _cross_slot_detected = True
        logger.warning("arq cross-slot error detected — switching to fallback queue: %s", e)
        await _fallback_enqueue("retry_notification_task", log_id, defer_seconds)
        return None
    raise
```

`_cross_slot_detected` is a module-level latch: once we've seen it, every later enqueue goes straight to the fallback instead of paying for a failed transaction first. It is only ever set `False → True`, from a single asyncio thread, so it needs no lock — but it does deserve the comment explaining why, because "global mutable flag, no lock" is exactly the line a reviewer should stop on.

## The failure that actually took us down

Every problem above degrades something. None of them, on their own, takes a platform offline. What took us offline was this line in the Dockerfile:

```dockerfile
CMD ["uvicorn", "app.main:app", "--workers", "1"]
```

Here is the chain. A hot loop — the bot orchestrator — called Redis on every iteration. Redis started returning errors instead of results. Errors are fast, so the loop spun faster, and each iteration awaited a connection that would not open. The event loop stalled.

With one worker, the event loop **is** the server. It is also what answers `/health`. So the health check didn't return "unhealthy" — it returned nothing at all, timed out, and the load balancer concluded the target was dead and pulled it. There was one target.

> A cache that has stopped working should degrade the features that use the cache. Ours took down the health check, which took down the routing, which took down everything.

Two changes:

```dockerfile
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "2", "--limit-concurrency", "200", \
     "--proxy-headers", "--forwarded-allow-ips", "*"]
```

Two workers means a stalled event loop degrades half the capacity instead of all of it, and the health check has somewhere else to be answered. `--limit-concurrency 200` bounds how many connections can pile up before we start refusing — refusing quickly is a much better failure than accepting everything and answering nothing.

And the hot loops got a circuit breaker:

```python
class RedisCircuitBreaker:
    def __init__(self, name="redis", failure_threshold=5, recovery_seconds=30.0):
        ...

    @property
    def is_open(self) -> bool:
        if self._consecutive_failures < self._failure_threshold:
            return False
        if time.monotonic() - self._opened_at >= self._recovery_seconds:
            return False   # recovery window elapsed — allow one probe
        return True
```

Five consecutive failures and it opens for thirty seconds; callers check `is_open` and take their fallback path without touching the network. No dependency, about eighty lines. The value isn't sophistication — it's that a broken dependency stops being able to consume the event loop.

## What I actually changed my mind about

The tempting lesson is "read the ElastiCache docs". The real one is narrower and more annoying:

**CI could not have caught this.** Not "we forgot to write the test" — the test environment was standalone Redis, and standalone Redis accepts `KEYS`, accepts multi-key `DEL`, and accepts arq's transactions. A green suite was telling the truth about a database we do not run in production.

So the rule I wrote into the repo afterwards is a question rather than a fix, and it's the first thing in the file:

> When an error occurs in prod, ask yourself why the CI or the test cases didn't find that issue.

Sometimes the answer is a missing test. This time it was that our lower environments were a different product with the same name, and the only honest fixes are to run cluster mode in CI or to encode the constraints where a reviewer will see them. We did the second, immediately, and the first more slowly. The four rules — no `KEYS`, one key per `DELETE`, expect arq to fail, never one worker — sit at the top of the repo's instructions file, above the architecture notes, because they are cheap to read and expensive to rediscover.

The outage cost an afternoon. The write-up took an hour. The four lines have caught the same mistake twice since.
