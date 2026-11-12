import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "../../../docs/contracts/publish-frontmatter.schema.json";
import { diagnostic } from "./types";
const ajv = new Ajv2020({ strict: false, allErrors: true, multipleOfPrecision: 8 });
addFormats(ajv);
const frontmatter = ajv.compile(schema);
export function validateFrontmatter(value: unknown) {
  if (frontmatter(value)) return [];
  return (frontmatter.errors ?? []).map((error) => diagnostic(
    "SCHEMA_INVALID", error.message ?? "Invalid frontmatter", `/frontmatter${error.instancePath}`,
  ));
}
