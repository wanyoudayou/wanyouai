import { createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { PublishInput } from "./types";
export { validateFrontmatter } from "./frontmatter";

const ajv = new Ajv2020({ strict: false, allErrors: true, multipleOfPrecision: 8 });
addFormats(ajv);
const envelope = ajv.compile({
  type: "object", additionalProperties: false,
  required: ["client_request_id", "frontmatter", "markdown", "media"],
  properties: {
    client_request_id: { type: "string", pattern: "^[A-Za-z0-9_-]{1,128}$" },
    frontmatter: { type: "object" },
    markdown: { type: "string", maxLength: 1000000 },
    media: { type: "array", maxItems: 100, items: {
      type: "object", additionalProperties: false,
      required: ["source_path", "storage_path", "sha256", "mime_type", "width", "height"],
      properties: {
        source_path: { type: "string", minLength: 1, maxLength: 2048 },
        storage_path: { type: "string", minLength: 1, maxLength: 512 },
        sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
        mime_type: { type: "string", maxLength: 100 },
        width: { type: "integer", minimum: 1, maximum: 20000 },
        height: { type: "integer", minimum: 1, maximum: 20000 },
      },
    } },
  },
});
export function validEnvelope(value: unknown): value is PublishInput { return !!envelope(value); }
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
export function contentHash(input: PublishInput) {
  const media = input.media.map(canonicalJson).sort().map((item) => JSON.parse(item));
  return createHash("sha256").update(`${canonicalJson(input.frontmatter)}\n---\n${input.markdown}\n\0\0${canonicalJson(media)}`).digest("hex");
}
