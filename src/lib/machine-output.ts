import { seriesPath } from "@/lib/content-kinds";
export { seriesPath } from "@/lib/content-kinds";
import { createHash } from "node:crypto";
import type { PublicCatalog } from "./public-catalog";

const protocolKeys = [
  "scope",
  "deliverable",
  "cadence",
  "compensation",
  "exit",
  "ownership",
];
export function validProtocol(value: unknown) {
  return (
    !!value &&
    typeof value === "object" &&
    protocolKeys.every(
      (key) =>
        typeof (value as Record<string, unknown>)[key] === "string" &&
        String((value as Record<string, unknown>)[key]).trim(),
    )
  );
}
export function buildMachineCard(catalog: PublicCatalog, origin: string) {
  const { site, articles, series, services, events, readmes } = catalog;
  const currency = site.commerce.subscriptionPrice?.currency ?? "CNY";
  const albums = series.filter(
    (album) =>
      album.status === "published" &&
      readmes.some((readme) => readme.article_id === album.readme_article_id) &&
      articles.some(
        (article) =>
          article.id === album.readme_article_id &&
          article.series_id === album.id &&
          article.access === "public",
      ),
  );
  const price = (amount: number, model: string) => ({
    amount,
    currency,
    model,
  });
  return {
    schema: "youai.card/0.2",
    generated_at: new Date(catalog.updated).toISOString(),
    identity: {
      name: site.ownerName,
      display_name: site.siteName,
      one_liner: site.identity.oneLiner,
      site: origin,
      languages: site.identity.languages,
      timezone: site.identity.timezone,
      focus_areas: site.identity.focusAreas,
      links: {},
    },
    capabilities: {
      services: services
        .filter(
          (service) =>
            service.price !== null && validProtocol(service.protocol_snapshot),
        )
        .map((service) => ({
          id: service.slug,
          name: service.title,
          deliverables: service.deliverables,
          duration: service.duration ?? "",
          price: price(service.price!, "per_project"),
          capacity:
            service.capacity_per_month === null
              ? site.constraints.currentLoad
              : `每月 ${service.capacity_per_month} 单；${site.constraints.currentLoad ?? ""}`,
          agreement_url: `${origin}/card#service-${service.slug}`,
          inquiry_endpoint: `${origin}/api/services/inquire`,
        })),
      skills: [...albums
        .filter((album) => album.type === "skill" && !catalog.skills?.some(skill => skill.legacy_series_id === album.id))
        .map((album) => ({
          title: album.title,
          url: origin + seriesPath(album),
          access: album.price > 0 ? "paid-series" : "free",
        })), ...(catalog.skills ?? []).flatMap(skill => {
          const article = articles.find(a => a.id === skill.id && a.type === "skill" && a.status === "published");
          return article && skill.current_release ? [{ title: article.title, url: `${origin}/skills/${article.slug}`, access: skill.price > 0 ? "paid-skill" : "registered" }] : [];
        })],
      content_offerings: [
        ...albums
          .filter(
            (album) =>
              ["collection", "handbook"].includes(album.type) ||
              (album.type === "event" &&
                events.some(
                  (event) =>
                    event.series_id === album.id &&
                    ["upcoming", "registering"].includes(event.state),
                )),
          )
          .map((album) => {
            const amount =
              album.type === "event"
                ? (events.find((event) => event.series_id === album.id)
                    ?.ticket_price ?? 0)
                : album.price;
            return {
              type: "series",
              title: album.title,
              url: origin + seriesPath(album),
              access: amount > 0 ? "paid-series" : "free",
              ...(amount > 0 && { price: price(amount, "one_time") }),
              ...(album.task && { task: album.task }),
            };
          }),
        ...articles
          .filter(
            (article) =>
              article.type === "blog" &&
              article.status === "published" &&
              article.access === "paid",
          )
          .map((article) => ({
            type: "single",
            title: article.title,
            url: `${origin}/blog/${article.slug}`,
            access: "paid-single",
            price: price(article.price!, "one_time"),
          })),
      ],
    },
    constraints: {
      working_hours: site.constraints.workingHours,
      response_time: site.constraints.responseTime,
      current_load: site.constraints.currentLoad,
      exclusions: site.constraints.exclusions,
    },
    protocol: {
      inquiry: {
        accepted_fields: [
          "intent",
          "budget_range",
          "deadline",
          "context_links",
        ],
        note: "请通过服务详情页提交询价，合作安排由站主确认。",
      },
      human_channel: {
        ...(site.contact.email && { email: site.contact.email }),
        ...(site.contact.bookingUrl && {
          booking_url: site.contact.bookingUrl.startsWith("/")
            ? `${origin}${site.contact.bookingUrl}`
            : site.contact.bookingUrl,
        }),
      },
      escalation: "所有订单最终由本人确认；agent 可完成信息交换与材料准备。",
    },
    evidence: {},
    source_of_truth: `${origin}/card`,
  };
}
export function buildLlmsText(catalog: PublicCatalog, origin: string) {
  const lines = [
    `# ${catalog.site.siteName}`,
    "",
    catalog.site.identity.oneLiner,
    "",
    `名片：${origin}/card`,
    "",
  ];
  for (const album of catalog.series) {
    if (album.status !== "published") continue;
    if (
      album.type === "event" &&
      !catalog.events.some(
        (event) => event.series_id === album.id && event.state !== "ended",
      )
    )
      continue;
    const readme = catalog.readmes.find(
      (item) => item.article_id === album.readme_article_id,
    );
    if (
      !readme ||
      !catalog.articles.some(
        (article) =>
          article.id === readme.article_id &&
          article.series_id === album.id &&
          article.access === "public",
      )
    )
      continue;
    lines.push(
      `## ${album.title}`,
      origin + seriesPath(album),
      ...(album.task ? [album.task] : []),
      readme.content,
      "",
    );
    for (const article of catalog.articles.filter(
      (article) =>
        article.series_id === album.id &&
        article.status === "published" &&
        article.id !== album.readme_article_id,
    )) {
      lines.push(
        `### ${article.title} [${article.access}]`,
        `${origin}${seriesPath(album)}?article=${article.slug}`,
        ["subscriber", "paid"].includes(article.access)
          ? article.preview_md
          : (article.summary ?? ""),
        "",
      );
    }
  }
  for (const article of catalog.articles.filter(
    (article) => ["blog", "skill"].includes(article.type) && article.status === "published",
  ))
    lines.push(
      `## ${article.title} [${article.access}]`,
      `${origin}/${article.type === "skill" ? "skills" : "blog"}/${article.slug}`,
      ["subscriber", "paid"].includes(article.access)
        ? article.preview_md
        : (article.summary ?? ""),
      "",
    );
  return lines.join("\n");
}
export function machineResponse(
  body: string,
  contentType: string,
  request: Request,
) {
  const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=3600",
    ETag: etag,
  };
  const match = request.headers
    .get("if-none-match")
    ?.split(",")
    .some(
      (value) =>
        value.trim() === "*" || value.trim().replace(/^W\//, "") === etag,
    );
  return new Response(match ? null : body, {
    status: match ? 304 : 200,
    headers,
  });
}
