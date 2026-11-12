import type { Media } from "@/lib/publishing/types";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MEDIA_UPLOAD_BUCKET = "media-uploads";
export const IMAGE_ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";
export type MediaAsset = {
  id: string;
  storage_path: string;
  sha256: string;
  mime_type: string;
  byte_size: number;
  width: number;
  height: number;
  name: string;
  alt: string;
  archived: boolean;
  created_at: string;
  url: string;
};
export function assetMedia(asset: MediaAsset, sourcePath = asset.url): Media {
  return {
    source_path: sourcePath,
    storage_path: asset.storage_path,
    sha256: asset.sha256,
    mime_type: asset.mime_type,
    width: asset.width,
    height: asset.height,
  };
}
export class MediaLibraryError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
