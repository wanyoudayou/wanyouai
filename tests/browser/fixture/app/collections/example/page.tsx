import { ProseReader } from "@/components/reading/prose-reader";
import { ReadingShellBridge } from "@/components/reading/reading-shell";
export default function Page() {
  return (
    <section className="mx-auto max-w-3xl space-y-6 p-6">
      <ReadingShellBridge
        value={{
          pathname: "/collections/example",
          navigation: {
            pathname: "/collections/example",
            title: "使用指南",
            backHref: "/collections",
            currentSlug: "intro",
            chapters: [
              {
                href: "/collections/example",
                title: "功能与使用方式",
                slug: "intro",
                locked: false,
                readme: true,
                status: "published",
              },
            ],
          },
          outline: <p className="p-4">功能与使用方式</p>,
          discussion: false,
        }}
      />
      <h1 className="text-3xl font-semibold">功能与使用方式</h1>
      <ProseReader
        markdown={
          '## 以内容开始\n\n一个部署对应一个站主。用清晰的目录和真实的权限组织知识。\n\n> 从公开介绍开始，再逐步完善内容。\n\n| 内容 | 管理方式 |\n| --- | --- |\n| 文章 | 发布工作台 |\n| 专辑 | 介绍与章节 |\n\n```ts\nconst theme = "system";\n```'
        }
      />
    </section>
  );
}
