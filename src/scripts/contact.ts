/**
 * Contact form submission.
 *
 * The form is a real <form> with a real action path, so it degrades to a normal
 * POST if this module fails to load. Everything here is enhancement: inline
 * errors, a busy state, and a success message that replaces the form rather
 * than leaving the sender wondering whether it went.
 */
const form = document.querySelector<HTMLFormElement>("#contact-form");

if (form) {
  const status = document.querySelector<HTMLElement>("#cf-status");
  const button = form.querySelector<HTMLButtonElement>("button[type=submit]");
  const label = form.querySelector<HTMLElement>("[data-label]");
  const rendered = Date.now();

  const errorFor = (field: string) =>
    form.querySelector<HTMLElement>(`[data-err-for="${field}"]`);

  function clearErrors() {
    form!.querySelectorAll<HTMLElement>(".err").forEach((el) => (el.textContent = ""));
    form!
      .querySelectorAll<HTMLElement>("[aria-invalid]")
      .forEach((el) => el.removeAttribute("aria-invalid"));
  }

  function showErrors(errors: Record<string, string>) {
    let first: HTMLElement | null = null;
    for (const [field, msg] of Object.entries(errors)) {
      const box = errorFor(field);
      if (box) box.textContent = msg;
      const input = form!.querySelector<HTMLElement>(`[name="${field}"]`);
      if (input) {
        input.setAttribute("aria-invalid", "true");
        if (!first) first = input;
      }
    }
    // Move focus to the first problem so keyboard and screen-reader users are
    // not left hunting for what went wrong.
    first?.focus();
  }

  function setBusy(busy: boolean) {
    if (button) button.disabled = busy;
    if (label) label.textContent = busy ? "Sending…" : "Send message";
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearErrors();
    if (status) {
      status.textContent = "";
      status.style.color = "";
    }
    setBusy(true);

    const data = new FormData(form);
    const payload = {
      name: String(data.get("name") ?? ""),
      email: String(data.get("email") ?? ""),
      company: String(data.get("company") ?? ""),
      message: String(data.get("message") ?? ""),
      website: String(data.get("website") ?? ""),
      elapsed: Date.now() - rendered,
    };

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const out = await res.json().catch(() => ({}));

      if (res.status === 422 && out.errors) {
        setBusy(false);
        showErrors(out.errors);
        return;
      }

      if (!res.ok || !out.ok) {
        setBusy(false);
        if (status) {
          status.style.color = "#d08b6a";
          status.textContent =
            out.error ??
            "Something went wrong sending that. Please email work.aadityak@gmail.com directly.";
        }
        return;
      }

      // Replace the form. Leaving a filled-in form on screen invites a second
      // submit, and the sender has no way to tell the first one worked.
      form.innerHTML = `
        <div class="md:col-span-2">
          <p class="font-display text-2xl font-black uppercase tracking-tight text-bone md:text-3xl">
            Message sent
          </p>
          <p class="mt-3 max-w-[46ch] font-body text-bone-dim">
            Thanks — it's with me. I reply within a day, usually sooner. If it's urgent,
            <a class="ul" href="mailto:work.aadityak@gmail.com">email me directly</a>.
          </p>
        </div>`;
      form.querySelector("p")?.setAttribute("tabindex", "-1");
      (form.querySelector("p") as HTMLElement | null)?.focus();
    } catch {
      setBusy(false);
      if (status) {
        status.style.color = "#d08b6a";
        status.textContent =
          "Couldn't reach the server. Check your connection, or email work.aadityak@gmail.com.";
      }
    }
  });

  // Clear a field's error as soon as the person starts fixing it — leaving red
  // text under an input someone is actively correcting is just nagging.
  form.addEventListener("input", (e) => {
    const el = e.target as HTMLElement;
    const name = el.getAttribute("name");
    if (!name) return;
    el.removeAttribute("aria-invalid");
    const box = errorFor(name);
    if (box) box.textContent = "";
  });
}
