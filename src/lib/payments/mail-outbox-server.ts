import "server-only";
import type { createSupabaseServiceClient } from "../supabase/service";
import { parseMailHealth, type MailJob, type OutboxGateway } from "./mail-outbox";

export function mailOutboxGateway(service: ReturnType<typeof createSupabaseServiceClient>): OutboxGateway {
  return {
    async claim() {
      const { data, error } = await service.rpc("claim_email_job");
      if (error) throw new Error("Mail queue unavailable");
      return data as MailJob | null;
    },
    async recipient(userId) {
      const { data, error } = await service.auth.admin.getUserById(userId);
      if (error) throw new Error("Recipient lookup unavailable");
      return data.user?.email ?? null;
    },
    async prepare(job, message, fingerprint) {
      const { data, error } = await service.rpc("prepare_email_job", {
        p_id: job.id, p_token: job.lease_token, p_message: message, p_fingerprint: fingerprint,
      });
      if (error || !data) throw new Error("Mail preparation unavailable");
      return data as MailJob;
    },
    async finish(job, delivery) {
      if (delivery.outcome !== "sent" && typeof delivery.providerStatus === "number" &&
        Number.isInteger(delivery.providerStatus) && delivery.providerStatus >= 400 && delivery.providerStatus <= 599) {
        // Keep provider diagnostics useful without logging recipients, payloads or response bodies.
        console.warn("mail_provider_response", {
          operationId: job.id, status: delivery.providerStatus, outcome: delivery.outcome, code: delivery.code,
        });
      }
      const { data, error } = await service.rpc("finish_email_job", {
        p_id: job.id, p_token: job.lease_token, p_outcome: delivery.outcome,
        p_code: delivery.outcome === "sent" ? null : delivery.code,
        p_provider_id: delivery.outcome === "sent" ? delivery.providerId : null,
      });
      if (error) throw new Error("Mail acknowledgement unavailable");
      return data === true;
    },
    async health() {
      const { data, error } = await service.rpc("email_outbox_health");
      if (error || !data) throw new Error("Mail health unavailable");
      return parseMailHealth(data);
    },
  };
}
