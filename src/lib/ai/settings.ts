import type { createSupabaseServiceClient } from "../supabase/service";
import { AIError, connectionDefinition, validAPIKey, type AIConnection, type ConnectionDefinition } from "./connections";

type Service = ReturnType<typeof createSupabaseServiceClient>;
export type AISettings = {
  revision: string; generation_connection: string | null; embedding_connection: string | null;
  embedding_key_shared: boolean; avatar_enabled: boolean; anonymous_entry: boolean;
  owner_instructions: string; monthly_limit: number | null;
};
export type ConnectionView = ConnectionDefinition & { id: string; verifiedAt: string | null; keySet: boolean };
export type AISettingsView = {
  revision: string; generation: ConnectionView | null; embedding: ConnectionView | null;
  embeddingKeyShared: boolean; avatarEnabled: boolean; anonymousEntry: boolean;
  ownerInstructions: string; monthlyLimit: number | null; canMigrate: boolean;
};
export async function loadAISettings(service: Service): Promise<AISettings> {
  const { data, error } = await service.from("ai_settings").select("revision,generation_connection,embedding_connection,embedding_key_shared,avatar_enabled,anonymous_entry,owner_instructions,monthly_limit").eq("id", 1).single();
  if (error || !data) throw new AIError("AI_SETTINGS_UNAVAILABLE");
  return data as AISettings;
}
export async function generationReady(service: Service): Promise<boolean> {
  const settings = await loadAISettings(service);
  if (!settings.generation_connection) return false;
  const result = await service.from("ai_connections").select("verified_at").eq("id", settings.generation_connection).single();
  if (result.error || !result.data) throw new AIError("AI_CONNECTION_UNAVAILABLE");
  return result.data.verified_at !== null;
}

/** Trusted-server use only. Never pass this return value to a client component or response. */
export async function loadAIConnection(service: Service, id: string): Promise<AIConnection> {
  const { data, error } = await service.from("ai_connections").select("id,purpose,protocol,base_url,model,api_key,verified_at").eq("id", id).single();
  if (error || !data || !validAPIKey(data.api_key)) throw new AIError("AI_CONNECTION_UNAVAILABLE");
  const definition = connectionDefinition({ purpose: data.purpose, protocol: data.protocol, baseUrl: data.base_url, model: data.model });
  return { ...definition, id: data.id, apiKey: data.api_key, verifiedAt: data.verified_at };
}

/** Explicit metadata projection: credential columns are not read for the management view. */
export async function aiSettingsView(service: Service): Promise<AISettingsView> {
  const settings = await loadAISettings(service);
  const ids = [settings.generation_connection, settings.embedding_connection].filter((id): id is string => !!id);
  const { data, error } = ids.length ? await service.from("ai_connections").select("id,purpose,protocol,base_url,model,verified_at").in("id", ids) : { data: [], error: null };
  if (error || data?.length !== new Set(ids).size) throw new AIError("AI_CONNECTION_UNAVAILABLE");
  const connections = new Map((data ?? []).map(row => [row.id, {
    ...connectionDefinition({ purpose: row.purpose, protocol: row.protocol, baseUrl: row.base_url, model: row.model }),
    id: row.id, verifiedAt: row.verified_at, keySet: true,
  } as ConnectionView]));
  return {
    revision: settings.revision, generation: connections.get(settings.generation_connection ?? "") ?? null,
    embedding: connections.get(settings.embedding_connection ?? "") ?? null,
    embeddingKeyShared: settings.embedding_key_shared, avatarEnabled: settings.avatar_enabled,
    anonymousEntry: settings.anonymous_entry, ownerInstructions: settings.owner_instructions,
    monthlyLimit: settings.monthly_limit, canMigrate: !ids.length,
  };
}

