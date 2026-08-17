# aadityakushwaha.com

Personal site. Astro + Tailwind v4, static output, no client framework.

```bash
npm install
npm run dev      # localhost:4321
npm run build    # → dist/
```

## Layout

```
src/
  layouts/Base.astro     home shell: loader, reveal observer, fonts
  layouts/Post.astro     article shell + long-form type rules
  pages/index.astro      the whole home page; content lives in its frontmatter
  pages/writing/*.md     one file per article, layout set in its frontmatter
  styles/global.css      theme tokens, grain, reveal and marquee keyframes
```

## Adding an article

Drop a markdown file in `src/pages/writing/`:

```markdown
---
layout: ../../layouts/Post.astro
title: "Title"
description: "One sentence, used for meta and og:description."
date: 2026-08-17
status: "8 min read"
---
```

Then add it to the `Writing` list in `index.astro`. The list is hand-kept on
purpose — the order is editorial, not chronological.

## Motion

Animation is CSS; JavaScript only adds an `.in` class. Every animated element
renders in its final state if the script never runs, and the whole system is
disabled under `prefers-reduced-motion`.

## Deploy

Static output in `dist/`. Cloudflare Pages: build `npm run build`, output
directory `dist`.
