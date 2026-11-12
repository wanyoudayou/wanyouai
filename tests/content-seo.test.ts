import test from "node:test";
import assert from "node:assert/strict";
import { canonicalUrl, buildPublicMetadata } from "../src/lib/seo/metadata";

test("canonical preserves chapter identity and removes payment/tracking parameters", () => {
  assert.equal(
    canonicalUrl(
      "https://example.test",
      "/collections/guide?article=install&sign=SECRET&trade_no=123#x",
    ),
    "https://example.test/collections/guide?article=install",
  );
  assert.equal(
    canonicalUrl(
      "https://example.test",
      "/p/pricing?article=install&utm_source=demo",
    ),
    "https://example.test/p/pricing",
  );
  assert.throws(
    () => canonicalUrl("https://example.test", "//other.test/"),
    /origin/,
  );
});
test("metadata uses safe public title, URL and cover projection", () => {
  const meta = buildPublicMetadata({
    origin: "https://example.test",
    path: "/blog/read?sign=SECRET",
    title: "公开标题",
    siteName: "站点",
    description: "公开摘要",
    image: "javascript:bad()",
  });
  assert.equal(meta.alternates?.canonical, "https://example.test/blog/read");
  assert.doesNotMatch(JSON.stringify(meta), /SECRET|javascript:/);
  assert.deepEqual(meta.openGraph?.images, []);
  assert.deepEqual(meta.twitter?.images, []);
  assert.ok(meta.twitter && "card" in meta.twitter);
  assert.equal(meta.twitter.card, "summary");
});

test("missing and retired local images produce sharing summaries without broken image URLs", () => {
  for (const image of [
    null,
    "http://[invalid",
    "/images/home-hero.jpg?old=1",
    "https://example.test/images/logo.jpg",
    "/images/avatar.jpg",
  ]) {
    const meta = buildPublicMetadata({
      origin: "https://example.test",
      path: "/",
      title: "我的站点",
      siteName: "我的站点",
      description: "站点介绍",
      image,
    });
    assert.deepEqual(meta.openGraph?.images, [], String(image));
    assert.deepEqual(meta.twitter?.images, [], String(image));
    assert.ok(meta.twitter && "card" in meta.twitter);
    assert.equal(meta.twitter.card, "summary");
  }
});

test("configured public covers keep image sharing and preserve external asset paths", () => {
  for (const [image, expected] of [
    ["/assets/my-cover.png", "https://example.test/assets/my-cover.png"],
    ["https://media.example.test/images/logo.jpg", "https://media.example.test/images/logo.jpg"],
  ]) {
    const meta = buildPublicMetadata({
      origin: "https://example.test",
      path: "/blog/read",
      title: "公开标题",
      siteName: "站点",
      description: "公开摘要",
      image,
    });
    assert.deepEqual(meta.openGraph?.images, [{ url: expected }]);
    assert.deepEqual(meta.twitter?.images, [expected]);
    assert.ok(meta.twitter && "card" in meta.twitter);
    assert.equal(meta.twitter.card, "summary_large_image");
  }
});
