---
layout: ../../layouts/Post.astro
title: "Multi-tenant isolation below the application"
description: "Postgres row-level security turns tenant isolation from a promise the code makes into a constraint the database enforces. Then a permissive policy quietly hands one admin every tenant's rows."
date: 2026-08-17
status: "10 min read"
kicker: "Architecture — multi-tenant LMS"
hero: "/img/rls-hero.webp"
figure: "/img/rls-fig.webp"
figureAlt: "Same query, two connections. One passes through the policy; one is allowed to bypass it."
panels:
  - label: "Tables under tenant RLS"
    value: "114"
  - label: "Migrations"
    value: "141"
  - label: "RLS integration suites"
    value: "8"
  - label: "Roles that may bypass, of three"
    value: "2"
---

Every multi-tenant application starts with the same rule: never return one tenant's rows to another. And in most of them, that rule lives in application code — a `WHERE tenant_id = ?` repeated across every query, held in place by code review and habit.

That works until the day somebody writes a query without it. There is no mechanism there, only diligence, and diligence has a bad long-run record against a thousand-file codebase and a deadline.

Postgres row-level security moves the rule underneath the application. The database refuses to return the rows, and it refuses whether the query was written by me, by a colleague, by an agent, or by a `psql` session at 2am.

## The shape of the policy

Every tenant-scoped table in the LMS gets the same treatment, applied by one helper in the migration so that 114 tables cannot drift into 114 slightly different rules:

```python
def apply_tenant_rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;")
    op.execute(f"""
        CREATE POLICY {table}_tenant_isolation ON {table}
          USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
          WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
    """)
    op.execute(f"""
        CREATE POLICY {table}_platform_bypass ON {table}
          USING (current_setting('app.role_scope', true) = 'platform');
    """)
```

Four details in there earn their place.

**`FORCE`, not just `ENABLE`.** A table's owner bypasses RLS by default. If your migrations run as the same role your application connects as — and in a lot of setups they do — `ENABLE ROW LEVEL SECURITY` alone buys you nothing at all. `FORCE` applies the policy to the owner too.

**`USING` and `WITH CHECK` are different questions.** `USING` filters what you can read. `WITH CHECK` validates what you write. Omit the second and a tenant can happily `INSERT` a row stamped with somebody else's `tenant_id` — a row they then cannot see, which is a fun class of bug to debug.

**`current_setting('app.tenant_id', true)`.** The `true` means "missing setting is NULL, not an error". That sounds like the lax option and is the opposite: `tenant_id = NULL` evaluates to NULL, NULL is not true, and the policy returns **zero rows**. Forget to set the GUC and you see nothing. It fails closed.

**The bypass is a separate policy.** Some work is legitimately cross-tenant: the outbox worker, retention jobs, platform administration. Multiple permissive policies on a table are combined with `OR`, so the bypass policy admits rows the isolation policy would have hidden. Keep reading — this is the part that later bit us.

## Two roles, two sessions

The policy is only half of it. The other half is that the application connects as a role which **cannot** bypass RLS. There are three:

| Role | Used by | RLS |
|---|---|---|
| `blitz` | Alembic migrations only | superuser — bypasses |
| `blitz_app` | Every request path | `NOSUPERUSER NOBYPASSRLS` — enforced |
| `blitz_platform` | Workers, retention, platform admin, test harness | `NOSUPERUSER BYPASSRLS` |

Three connection strings, and the rule that matters is: **never use `blitz` at runtime.** It is a superuser, so it silently bypasses every policy on the page — no error, no warning, just complete data. It exists because migrations must create the tables the policies are attached to, and that is the only thing it is allowed to do.

This is also the concrete reason `FORCE` above is not optional. The migration role owns the tables, and an owner bypasses its own RLS by default.

Two engines for the two runtime roles, two sessionmakers, and a session helper that binds the GUCs so the policy has something to read:

```python
async with maker() as session, session.begin():
    if scope == "tenant":
        if ctx is None or ctx.tenant_id is None:
            raise RuntimeError("session_scope('tenant') requires a tenant in request context")
        await session.execute(text(f"SET LOCAL app.tenant_id = '{ctx.tenant_id!s}'"))
        ...
```

`SET LOCAL` scopes the setting to the transaction, so a pooled connection cannot carry one request's tenant into the next one's. That matters more than it looks: with a plain `SET`, connection reuse becomes a cross-tenant leak with excellent uptime.

The string interpolation there is deliberate and it needs its comment, because it is exactly the pattern a security reviewer should stop on. `SET LOCAL` does not accept bind parameters — Postgres will not take a placeholder there. So the values are inlined, and the only two values that reach it are a `UUID` object rendered to text and a string from a two-member enum. No user input has a path to that line. Written down, it survives review. Left bare, someone eventually "fixes" it by making it configurable.

## What breaks when the policy is subtly wrong

Here is the interesting failure, and it isn't in the SQL.

A platform administrator can open a specific tenant's admin UI — support opening a customer's account to see what they see. That principal has `role_scope = "platform"`, which is what makes the bypass policy fire, which is what lets platform tooling work at all.

So they opened one tenant's course list and Postgres, entirely correctly, gave them **every tenant's courses**. The bypass policy is permissive; permissive policies OR together; a platform principal inside a tenant UI matched the bypass on every row in the table. Nothing was misconfigured. The policy did what it says.

> The isolation policy was right, the bypass policy was right, and the composition of the two was wrong. That's the failure mode RLS actually has — not a missing policy, a policy that applies in a context nobody pictured when they wrote it.

The fix is a distinction the request context did not previously carry: a platform principal *operating inside one tenant* keeps platform RBAC but must take tenant **data** scope.

```python
# EXCEPTION: a platform admin operating *inside* one tenant (e.g. "Open admin")
# must NOT bypass RLS, or the tenant admin UI would list every tenant's rows.
if ctx.role_scope == "platform" and not ctx.data_scoped_tenant:
    effective_scope = "platform"
else:
    effective_scope = "tenant"
await session.execute(text(f"SET LOCAL app.role_scope = '{effective_scope}'"))
```

One boolean on the request context, one branch. What made it findable was that the whole decision lives in one function. Had the bypass been a `WHERE` clause the application composed per query, the same bug would have been distributed across every admin endpoint, and fixed in about six of them.

## Isolation you can test

The reason to push the rule into the database is that it becomes testable as a property rather than a habit. The harness inserts through the bypass role, reads through the enforcing one, and asserts absence:

```python
async def test_rls_isolates_users(tenant_pair) -> None:
    """Insert a user under A, read as B — must be invisible."""
    a_user_id = await _platform_insert_user(tenant_pair.a_id, "a@ex.com")

    _bind_tenant_ctx(tenant_pair.b_id)
    async with session_scope("tenant") as s:
        rows = (await s.execute(
            text("SELECT id FROM users WHERE id = :id"), {"id": a_user_id}
        )).scalars().all()
        assert rows == []
```

And the write side, which is the one people forget:

```python
async def test_rls_blocks_cross_tenant_insert(tenant_pair) -> None:
    """Under tenant B, inserting a row carrying tenant_id=A must fail WITH CHECK."""
```

Note that the test cannot cheat. Seeding requires `BYPASSRLS`, so if the two roles were ever collapsed into one the setup and the assertion would both be running under the same permissions and the test would pass for the wrong reason. Eight suites cover the tables where a leak would hurt most — users, courses, AI chat, embeddings, certificates, tags.

## What it does not buy you

RLS is not a substitute for authorisation. It answers "which tenant's rows is this connection allowed to see", and nothing whatsoever about whether *this user* should see *this course*. Roles, permissions and ownership all still live in the application.

What it buys is a floor. Below a certain kind of mistake, the database says no. A forgotten `WHERE` clause returns an empty list instead of a stranger's data; a compromised query path leaks nothing across the tenant boundary; a well-meaning migration script run against production sees only what its GUC allows.

The cost is real: three database roles to manage and keep straight, a GUC contract to keep, a helper every migration must remember to call, and the composition problem above, which you will meet eventually. That is a much better set of problems than trusting 141 migrations' worth of hand-written predicates — and unlike diligence, it holds while you are asleep.
