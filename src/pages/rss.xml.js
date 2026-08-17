import rss from "@astrojs/rss";

/**
 * A feed is the cheapest distribution surface a technical site has: aggregators,
 * newsletters and several AI crawlers all read it, and unlike a sitemap it
 * carries the description rather than just the URL.
 */
export async function GET(context) {
  const posts = Object.values(
    import.meta.glob("./writing/*.md", { eager: true }),
  );

  return rss({
    title: "Aaditya Kushwaha — Writing",
    description:
      "Production postmortems and architecture notes: Redis cluster mode, Postgres row-level security, document parsing, and the infrastructure underneath.",
    site: context.site,
    trailingSlash: false,
    items: posts
      .map((post) => ({
        title: post.frontmatter.title,
        description: post.frontmatter.description,
        pubDate: new Date(post.frontmatter.date),
        link: post.url,
        categories: post.frontmatter.kicker ? [post.frontmatter.kicker] : undefined,
      }))
      .sort((a, b) => b.pubDate - a.pubDate),
    customData: "<language>en</language>",
  });
}
