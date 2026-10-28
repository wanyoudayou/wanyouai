import { MediaLibraryError, type MediaAsset } from "./types";
type Completed = { asset: MediaAsset; sourceHash: string };
/** Recover known state before requesting a new non-overwriting Storage capability. */
export async function prepareUploadProtocol(
  ticket: {
    asset_id: string | null;
    source_hash: string;
    expires_at: string;
    resumed: boolean;
  },
  operations: {
    readAsset(id: string): Promise<MediaAsset>;
    finish(): Promise<Completed>;
    sign(): Promise<{ signedUrl: string; id: string }>;
  },
) {
  if (ticket.asset_id)
    return {
      asset: await operations.readAsset(ticket.asset_id),
      sourceHash: ticket.source_hash,
    };
  if (Date.parse(ticket.expires_at) <= Date.now())
    throw new MediaLibraryError(
      "上传凭据已过期，请重新选择文件。",
      "UPLOAD_EXPIRED",
    );
  if (ticket.resumed) {
    try {
      return await operations.finish();
    } catch (error) {
      if (
        !(error instanceof MediaLibraryError) ||
        error.code !== "UPLOAD_MISSING"
      )
        throw error;
    }
  }
  return operations.sign();
}
