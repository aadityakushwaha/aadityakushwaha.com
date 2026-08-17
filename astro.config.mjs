import { defineConfig } from "astro/config";
import tailwind from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://aadityakushwaha.com",
  integrations: [
    sitemap({
      // The 404 has noindex on it; keeping it out of the sitemap keeps the two
      // signals from contradicting each other.
      filter: (page) => !page.includes("/404"),
      serialize: (item) => ({
        ...item,
        // Articles are the pages worth recrawling; the home page changes with them.
        changefreq: item.url.includes("/writing/") ? "monthly" : "weekly",
        priority: item.url.includes("/writing/") ? 0.8 : 1.0,
      }),
    }),
  ],
  vite: { plugins: [tailwind()] },
});
