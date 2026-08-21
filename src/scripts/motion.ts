import { animate, inView, scroll, stagger, hover, press } from "motion";

/**
 * All page motion, driven by Motion (motion.dev).
 *
 * Two rules throughout:
 *   1. Elements are authored in their FINAL state. Motion sets the "from"
 *      keyframe, so if this module never loads the page is simply readable.
 *   2. Nothing animates layout — transform, opacity and clip-path only.
 */

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Motion's `spring`-adjacent ease. Exponential-out: fast, then a long settle. */
const OUT = [0.16, 1, 0.3, 1] as const;

function ready(fn: () => void) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn, { once: true });
  else fn();
}

ready(() => {
  const loader = document.getElementById("loader");
  const count = document.getElementById("count");

  /* ------------------------------------------------------------ entrance */
  function hero() {
    const chars = document.querySelectorAll<HTMLElement>("[data-chars] span");
    const bits = document.querySelectorAll<HTMLElement>("[data-hero]");
    const art = document.querySelector<HTMLElement>("[data-parallax]");

    if (art) {
      animate(art, { scale: [1.16, 1], opacity: [0, 1] }, { duration: 2.2, ease: OUT });
    }
    if (chars.length) {
      animate(
        chars,
        { y: ["105%", "0%"] },
        { duration: 1, ease: OUT, delay: stagger(0.035, { startDelay: 0.15 }) },
      );
    }
    if (bits.length) {
      animate(
        bits,
        { opacity: [0, 1], y: [18, 0] },
        { duration: 0.9, ease: OUT, delay: stagger(0.09, { startDelay: 0.55 }) },
      );
    }
  }

  // The loader is a first-impression device, not a fixture. Showing it again on
  // every internal navigation delays the largest contentful paint for someone
  // who has already seen it — and LCP is measured on every page load, not the
  // first one.
  const seen = sessionStorage.getItem("ak:seen") === "1";
  sessionStorage.setItem("ak:seen", "1");

  if (reduced || seen || !loader || !count) {
    loader?.remove();
    document.querySelectorAll<HTMLElement>("[data-chars] span, [data-hero]").forEach((el) => {
      el.style.opacity = "1";
      el.style.transform = "none";
    });
    hero();
  } else {
    // Motion drives the counter too, so the number and the fade share one clock.
    const c = { v: 0 };
    animate(c, { v: 100 }, {
      duration: 0.9,
      ease: "easeOut",
      onUpdate: () => (count.textContent = String(Math.round(c.v)).padStart(3, "0")),
    }).then(() => {
      animate(loader, { opacity: [1, 0] }, { duration: 0.6, ease: "easeInOut" }).then(() =>
        loader.remove(),
      );
      hero(); // overlaps the fade on purpose — one movement, not two
    });
  }

  /* --------------------------------------------------------- mobile menu */
  // A <details> element owns the open state, so the sheet toggles before this
  // module loads and keeps its own ARIA. All that is added here is closing it
  // once a link is taken — the anchors are on this page, so nothing else would.
  const menu = document.querySelector<HTMLDetailsElement>("[data-menu]");
  if (menu) {
    menu.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("a")) menu.open = false;
    });
    addEventListener("keydown", (e) => {
      if (e.key === "Escape") menu.open = false;
    });
    // Rotating a phone into landscape can cross the sm breakpoint, which hides
    // the toggle and would leave the sheet stuck open with no way out.
    matchMedia("(min-width: 640px)").addEventListener("change", (e) => {
      if (e.matches) menu.open = false;
    });
  }

  if (reduced) {
    // The counters are authored as "0" placeholders for the count-up to drive.
    // Without motion they are simply wrong numbers, so write the real ones.
    document.querySelectorAll<HTMLElement>("[data-num]").forEach((el) => {
      el.textContent =
        Number(el.getAttribute("data-num") || 0).toLocaleString("en-US") +
        (el.getAttribute("data-suffix") || "");
    });
    return;
  }

  /* -------------------------------------------------------- scroll-linked */
  const bar = document.querySelector<HTMLElement>("#progress");
  if (bar) scroll(animate(bar, { scaleX: [0, 1] }, { ease: "linear" }));

  const art = document.querySelector<HTMLElement>("[data-parallax]");
  if (art) {
    // Parallax bound to the hero's own exit, not to raw scrollY.
    scroll(animate(art, { y: [0, 190] }, { ease: "linear" }), {
      target: document.querySelector("[data-hero-section]") as Element,
      offset: ["start start", "end start"],
    });
  }

  document.querySelectorAll<HTMLElement>("[data-drift]").forEach((el) => {
    scroll(animate(el, { y: [40, -40] }, { ease: "linear" }), {
      target: el,
      offset: ["start end", "end start"],
    });
  });

  /* ------------------------------------------------------------- in view */
  inView(
    "[data-rise]",
    (el) => {
      animate(el, { opacity: [0, 1], y: [26, 0] }, { duration: 0.85, ease: OUT });
    },
    { amount: 0.15, margin: "0px 0px -10% 0px" },
  );

  inView(
    "[data-group]",
    (el) => {
      const kids = el.querySelectorAll<HTMLElement>(":scope > *");
      animate(kids, { opacity: [0, 1], y: [22, 0] }, { duration: 0.8, ease: OUT, delay: stagger(0.055) });
    },
    { amount: 0.1, margin: "0px 0px -8% 0px" },
  );

  inView(
    "[data-wipe]",
    (el) => {
      animate(el, { clipPath: ["inset(0 100% 0 0)", "inset(0 0% 0 0)"] }, { duration: 1.1, ease: OUT });
    },
    { amount: 0.2 },
  );

  inView(
    "[data-lines] > *",
    (el) => {
      animate(el, { y: ["100%", "0%"], opacity: [0, 1] }, { duration: 0.9, ease: OUT });
    },
    { amount: 0.4 },
  );

  /* ---------------------------------------------------------- case plates */
  const plates = [...document.querySelectorAll<HTMLElement>("[data-plate]")];
  const cases = [...document.querySelectorAll<HTMLElement>("[data-case]")];
  if (plates.length && cases.length) {
    cases.forEach((c, i) => {
      inView(
        c,
        () => {
          plates.forEach((p, n) => {
            animate(p, { opacity: n === i ? 1 : 0, scale: n === i ? 1 : 1.05 }, { duration: 0.7, ease: OUT });
          });
        },
        { amount: 0.5 },
      );
    });
  }

  /* -------------------------------------------------------------- cursor */
  const cur = document.querySelector<HTMLElement>("#cursor");
  if (cur && matchMedia("(hover: hover) and (pointer: fine)").matches) {
    let shown = false;
    addEventListener("pointermove", (e) => {
      if (!shown) {
        shown = true;
        animate(cur, { opacity: 1 }, { duration: 0.3 });
      }
      // Springs give the trailing weight; a linear tween reads as a stuck dot.
      animate(cur, { x: e.clientX, y: e.clientY }, { type: "spring", stiffness: 380, damping: 34, mass: 0.6 });
    });
    hover("a, button", (el) => {
      animate(cur, { scale: 3.6 }, { duration: 0.3, ease: OUT });
      return () => animate(cur, { scale: 1 }, { duration: 0.3, ease: OUT });
    });
    press("a, button", () => {
      animate(cur, { scale: 2.4 }, { duration: 0.15 });
      return () => animate(cur, { scale: 3.6 }, { duration: 0.2 });
    });
  }

  /* ------------------------------------------------- hero container open */
  // The frame expands from inset+rounded to full bleed across the hero's own
  // scroll range, so the container is the transition rather than a decoration.
  const frame = document.querySelector<HTMLElement>("[data-frame]");
  const heroSection = document.querySelector("[data-hero-section]");
  if (frame && heroSection) {
    const wide = matchMedia("(min-width: 768px)").matches;
    const from = wide ? "inset(1.75rem round 2rem)" : "inset(1.4rem round 1.6rem)";
    scroll(animate(frame, { clipPath: [from, "inset(0rem round 0rem)"] }, { ease: "linear" }), {
      target: heroSection,
      offset: ["start start", "45% start"],
    });
  }

  /* ------------------------------------------------------ stack text loop */
  const stack = document.querySelector<HTMLElement>("[data-stack]");
  if (stack) {
    const items = [...stack.querySelectorAll<HTMLElement>(".stack-item")];
    if (items.length > 1) {
      // Measure each word once, then animate the slot's width to match as the
      // word changes. A slot fixed to the longest word leaves a visible gap
      // after every shorter one, which reads as broken typesetting.
      const measure = () =>
        items.map((el) => {
          const prev = el.style.cssText;
          el.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;width:auto";
          const w = el.getBoundingClientRect().width;
          el.style.cssText = prev;
          // Never return 0 — a zero-width slot swallows the word entirely and
          // the sentence reads "I build  that carry load".
          return Math.max(Math.ceil(w) + 2, 40);
        });

      let widths = measure();

      items.forEach((el, i) => {
        el.style.opacity = i === 0 ? "1" : "0";
        el.style.transform = i === 0 ? "none" : "translateY(100%)";
      });
      stack.style.width = `${widths[0]}px`;

      // Webfonts land after first paint, so the first measurement is taken in
      // the fallback face and is wrong by a few percent. Re-measure once the
      // real face is ready.
      document.fonts?.ready.then(() => {
        widths = measure();
        stack.style.width = `${widths[i]}px`;
      });

      let i = 0;
      const HOLD = 2400;
      const step = () => {
        const cur = items[i];
        const nx = (i + 1) % items.length;
        const next = items[nx];
        // Out, in, and the slot resize all share one clock so the sentence
        // reflows exactly as the word swaps rather than a beat later.
        animate(cur, { y: ["0%", "-105%"], opacity: [1, 0] }, { duration: 0.55, ease: OUT });
        animate(next, { y: ["105%", "0%"], opacity: [0, 1] }, { duration: 0.6, ease: OUT });
        animate(stack, { width: `${widths[nx]}px` }, { duration: 0.6, ease: OUT });
        i = nx;
      };

      let timer = setInterval(step, HOLD);
      document.addEventListener("visibilitychange", () => {
        clearInterval(timer);
        if (!document.hidden) timer = setInterval(step, HOLD);
      });
    }
  }

  /* -------------------------------------------------- scroll-masked text */
  // Words light up as the block crosses the viewport, tied to scroll position
  // rather than a timer, so scrubbing back un-writes the sentence.
  document.querySelectorAll<HTMLElement>("[data-reveal-text]").forEach((block) => {
    const words = [...block.querySelectorAll<HTMLElement>(".reveal-word")];
    if (!words.length) return;

    scroll(
      (progress: number) => {
        // Spread the lit edge across the words with a short ramp, so a few are
        // mid-transition at any moment instead of snapping one at a time.
        const edge = progress * (words.length + 6) - 3;
        words.forEach((w, i) => w.classList.toggle("lit", i <= edge));
      },
      { target: block, offset: ["start 0.85", "end 0.45"] },
    );
  });

  /* ------------------------------------------------------ counting stats */
  inView(
    "[data-num]",
    (el) => {
      const target = Number(el.getAttribute("data-num") || 0);
      const suffix = el.getAttribute("data-suffix") || "";
      const o = { v: 0 };
      animate(o, { v: target }, {
        duration: 1.6,
        ease: "easeOut",
        onUpdate: () => (el.textContent = Math.round(o.v).toLocaleString("en-US") + suffix),
      });
    },
    { amount: 0.6 },
  );
});
