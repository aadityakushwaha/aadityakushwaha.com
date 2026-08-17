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

  if (reduced || !loader || !count) {
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
      duration: 1.4,
      ease: "easeOut",
      onUpdate: () => (count.textContent = String(Math.round(c.v)).padStart(3, "0")),
    }).then(() => {
      animate(loader, { opacity: [1, 0] }, { duration: 0.6, ease: "easeInOut" }).then(() =>
        loader.remove(),
      );
      hero(); // overlaps the fade on purpose — one movement, not two
    });
  }

  if (reduced) return;

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
