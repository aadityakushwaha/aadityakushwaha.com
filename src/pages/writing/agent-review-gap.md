---
layout: ../../layouts/Post.astro
title: "61% of AI-authored pull requests are never reviewed"
description: "A study of 33,596 agent-written PRs found most receive no recorded review. The diff isn't what's missing — the reasoning is."
date: 2026-08-17
status: "8 min read"
kicker: "Postmortem — agent workflows"
hero: "/img/post-hero.png"
figure: "/img/post-fig.png"
figureAlt: "Merges land; the reasoning that produced them does not."
panels:
  - label: "Agent PRs with no recorded review"
    value: "61.4%"
  - label: "Reviewed only by other agents"
    value: "22.6%"
  - label: "Any human participation"
    value: "15.9%"
  - label: "PRs analysed"
    value: "33,596"
---

A study presented at EASE 2026 looked at 33,596 agent-authored pull requests across GitHub repositories with at least 100 stars. The headline number is uncomfortable:

- **61.38%** received no recorded review activity at all.
- Of those that were reviewed, **58.77%** were reviewed exclusively by other agents.
- **15.9%** showed any observable human participation.

The authors are careful, and so should we be: absence of review comments is not proof that nobody looked. A maintainer can read a diff carefully and merge it without typing anything. What the data actually measures is what the repository *records*.

But that distinction is the interesting part, not a caveat to wave away. Because the same study found something sharper when it compared agent-authored PRs to human-authored PRs **in the same repositories**:

| | Agent-authored | Human-authored |
|---|---|---|
| Human-only review | 8.08% | 25.21% |
| Human comments that are agent-steering | 25.92% | 1.63% |

Overall human participation was almost identical — around 30% either way. What changed was its *shape*. On a human's PR, a human writes review. On an agent's PR, a human writes `@claude fix the lint failure`.

> That's not review. It's operating a machine. And the repository can no longer tell the two apart.

## The artifact that doesn't exist

Here's the thing I keep running into on my own projects.

When an agent works for two hours, it makes dozens of decisions. It picks an approach and abandons another. It notices the migration will lock a table and works around it. It tries a fix, watches a test fail, and tries something else. It leaves one thing deliberately unfinished because it needs a decision from a human.

Every one of those is a real engineering decision. And at the end you get a diff.

Git records what changed. It has never recorded why, and we've patched over that with commit messages, PR descriptions, and the fact that the author was a person you could walk over to and ask. Two of those three are now weaker. The commit message is written by the agent, summarising itself. The PR description is too — and [work by Gong et al.](https://arxiv.org/pdf/2601.04886) on message-code inconsistency found agent-authored PRs whose descriptions don't match their diffs are less likely to be accepted and take longer to merge. The third is gone entirely. There's nobody to ask. The session is closed and the reasoning went with it.

So the reviewer is handed a diff, told an agent wrote it, and asked to judge it. Of course review activity collapses. We removed the context that made review possible and kept the ritual.

## Reasoning is a build artifact

The fix I settled on is boring: have the agent write it down while it's working, into the repo, in a format anyone can read later.

Not a summary generated at the end — those are reconstructions, and reconstructions are where the phantom-change problem comes from. A record written *as the work happens*, at the moment the decision is made, when the alternatives are still in the agent's context.

That's what [worklog-mcp](https://github.com/aadityakushwaha/worklog-mcp) does. It's an MCP server with six tools:

| Tool | Called when |
|---|---|
| `log_work` | something meaningful is finished — the why, and any open loops |
| `record_decision` | an architectural choice is made, ADR-style with alternatives and consequences |
| `report_test_run` | a suite runs — result and counts, not full logs |
| `link_pr` | a PR is opened or merged |
| `update_progress` | a work item changes status, including *blocked* |
| `sync_doc` | a plan, spec, runbook or research note is updated |

Setup is one block in `.mcp.json`:

```json
{
  "mcpServers": {
    "worklog": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "github:aadityakushwaha/worklog-mcp"]
    }
  }
}
```

No account, no key, no server. Events append to `.worklog/events.jsonl`. It's JSONL, so reading it back is whatever you already know:

```bash
# every architectural decision, with the alternatives that were rejected
jq 'select(.tool=="record_decision") | {title, decision, alternatives}' .worklog/events.jsonl

# anything the agent left blocked
jq 'select(.tool=="update_progress" and .status=="blocked")' .worklog/events.jsonl
```

Every event carries a `sessionId` shared across one agent run and a unique `id` per event, both threaded automatically — so you can group a run afterwards, and a receiver can de-duplicate a retried call. If you want the events somewhere central instead of in the repo, set `WORKLOG_URL` and they're POSTed to a single endpoint you implement. The whole contract is one route and one JSON shape; a receiver is an afternoon's work.

## What this is not

I want to be precise, because there's a version of this pitch that overclaims and it isn't the honest one.

**This is not tamper-proof, and it is not signed.** The agent writes its own record. An agent that misreports its work produces a worklog that misreports its work — the same failure mode as the mismatched PR descriptions above. If you need cryptographic provenance for a regulator, you need something that signs file operations independently of the agent. That's a different tool and a harder problem. There's an [open request for exactly that on cline](https://github.com/cline/cline/issues/9952), filed under EU AI Act compliance, which went stale without being built — so the need is real and this isn't it.

What this *is*: a contemporaneous lab notebook. Better than reconstruction, weaker than attestation. For reviewing a colleague's agent's PR, for picking up work three weeks later, for answering "why is it done this way" — that's enough, and right now the alternative is nothing.

**It also won't fix your review culture.** If nobody reads the diff, nobody will read the worklog. It lowers the cost of reviewing well; it doesn't create the intent.

## Try it

```bash
npx -y github:aadityakushwaha/worklog-mcp
```

MIT, TypeScript, no dependencies beyond the MCP SDK and zod: **[github.com/aadityakushwaha/worklog-mcp](https://github.com/aadityakushwaha/worklog-mcp)**

If you're running agents on a team, I'd genuinely like to know which of the six tools you actually use. My guess is `record_decision` and `update_progress` carry the weight and the rest are noise — but that's a guess, and the log will tell me.

---

*Sources: Duma et al., [These Aren't the Reviews You're Looking For: How Humans Review AI-Generated Pull Requests](https://arxiv.org/pdf/2605.02273), EASE 2026 · Gong et al., [Analyzing Message-Code Inconsistency in AI Coding Agent-Authored Pull Requests](https://arxiv.org/pdf/2601.04886), 2026*
