import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../src/app/media/[slug]/[file]/route";
import { mediaStoragePath, publicMediaUrl, storagePublicUrl } from "../src/lib/publishing/media-url";

const hash = "a".repeat(64);
const path = `media/sample-article/${hash}.png`;

test("发布媒体地址只保留站内路径，重部署后由当前 Supabase URL 解析", async () => {
  assert.equal(publicMediaUrl(path), `/media/sample-article/${hash}.png`);
  assert.equal(mediaStoragePath("sample-article", `${hash}.png`), path);
  assert.equal(storagePublicUrl(path, "https://new-project.supabase.co", "media"),
    `https://new-project.supabase.co/storage/v1/object/public/media/${path}`);

  const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://new-project.supabase.co";
    const response = await GET(new Request("https://opcost.example/media/sample-article/image.png"), {
      params: Promise.resolve({ slug: "sample-article", file: `${hash}.png` }),
    });
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), `https://new-project.supabase.co/storage/v1/object/public/media/${path}`);
    assert.equal(response.headers.get("cache-control"), "public, max-age=60");
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previous;
  }
});

test("媒体路由拒绝路径穿越、非哈希文件和受限类型", async () => {
  for (const [slug, file] of [["..", `${hash}.png`], ["sample-article", "logo.png"], ["sample-article", `${hash}.svg`], ["sample-article", `${hash}.png/other`]]) {
    assert.equal(mediaStoragePath(slug, file), null);
    const response = await GET(new Request("https://opcost.example/media/invalid"), { params: Promise.resolve({ slug, file }) });
    assert.equal(response.status, 404);
  }
  assert.throws(() => publicMediaUrl("media/sample-article/logo.png"));
  assert.throws(() => storagePublicUrl(path, "https://user:password@project.supabase.co", "media"));
});
