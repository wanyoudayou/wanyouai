import { AISettingsForm } from "@/components/admin/ai-settings-form";
export default async function Page({ searchParams }: { searchParams: Promise<{ fixture?: string }> }) {
  const ready = (await searchParams).fixture === "ready";
  return <section className="mx-auto w-full max-w-4xl min-w-0 space-y-6 p-4 sm:p-6"><h1 className="text-2xl font-semibold">AI 设置</h1><AISettingsForm initial={{
    revision: "00000000-0000-4000-8000-000000000001",
    generation: ready ? { id: "00000000-0000-4000-8000-000000000002", purpose: "generation", protocol: "chat", baseUrl: "https://api.deepseek.com", model: "synthetic-model", verifiedAt: "2026-10-21T00:00:00Z", keySet: true } : null,
    embedding: ready ? { id: "00000000-0000-4000-8000-000000000003", purpose: "embedding", protocol: "embeddings", baseUrl: "https://api.siliconflow.cn/v1", model: "BAAI/bge-m3", verifiedAt: "2026-10-21T00:00:00Z", keySet: true } : null, embeddingKeyShared: false,
    avatarEnabled: false, anonymousEntry: false, ownerInstructions: "使用本站资料回答。", monthlyLimit: null, canMigrate: true,
  }} /></section>;
}
