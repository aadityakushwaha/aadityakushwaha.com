/**
 * Marks the contents entry for whichever section is currently being read.
 *
 * Driven by the heading that most recently crossed the top band of the
 * viewport rather than by "is visible" — with short sections several headings
 * are on screen at once, and highlighting all of them tells the reader nothing.
 */
const links = [...document.querySelectorAll<HTMLElement>("[data-toc]")];
if (links.length) {
  const heads = [...document.querySelectorAll<HTMLElement>(".prose-post h2")];

  const paint = () => {
    const line = window.scrollY + window.innerHeight * 0.3;
    let active = heads[0]?.id ?? "";
    for (const h of heads) {
      if (h.getBoundingClientRect().top + window.scrollY <= line) active = h.id;
      else break;
    }
    for (const a of links) {
      const on = a.getAttribute("data-toc") === active;
      a.style.color = on ? "var(--color-bone)" : "";
      a.style.backgroundSize = on ? "100% 1px" : "";
    }
  };

  let queued = false;
  addEventListener(
    "scroll",
    () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        paint();
        queued = false;
      });
    },
    { passive: true },
  );
  paint();
}
