import type { createSupabaseServiceClient } from "../supabase/service";
import type { AIConnection } from "./connections";
import { AIError } from "./connections";
import { loadAIConnection, loadAISettings, type AISettings } from "./settings";

type Service = ReturnType<typeof createSupabaseServiceClient>;
export type AvatarRuntime = {
  settings: AISettings; generation: AIConnection; embedding: AIConnection;
  indexId: string; sourceRevision: number; threshold: number;
};
export async function loadAvatarRuntime(service: Service): Promise<AvatarRuntime | null> {
  const [settings, site, control] = await Promise.all([
    loadAISettings(service),
    service.from("site_config").select("avatar_config").eq("id", 1).single(),
    service.from("knowledge_index_control").select("active_generation,source_revision").eq("id", 1).single(),
  ]);
  if (site.error || control.error || !site.data || !control.data) throw new AIError("AVATAR_READINESS_UNAVAILABLE");
  if (!settings.avatar_enabled || !settings.generation_connection || !settings.embedding_connection || !control.data.active_generation || site.data.avatar_config?.enabled !== true) return null;
  const index = await service.from("knowledge_index_generations").select("id,connection_id,state,threshold").eq("id", control.data.active_generation).single();
  if (index.error || !index.data) throw new AIError("AVATAR_READINESS_UNAVAILABLE");
  if (index.data.state !== "active" || typeof index.data.threshold !== "number" || !Number.isFinite(index.data.threshold)) return null;
  const [generation, embedding] = await Promise.all([
    loadAIConnection(service, settings.generation_connection), loadAIConnection(service, index.data.connection_id),
  ]);
  if (!generation.verifiedAt || !embedding.verifiedAt) return null;
  return { settings, generation, embedding, indexId: index.data.id, sourceRevision: control.data.source_revision, threshold: index.data.threshold };
}
