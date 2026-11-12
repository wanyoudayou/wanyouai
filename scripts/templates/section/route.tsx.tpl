import type { Metadata } from "next";
import Root from "@/sections/__NAME__/page";
import { renderSection, sectionMetadata } from "@/lib/sections/route";

export const metadata: Metadata = sectionMetadata("__NAME__");

export default function Page(props: { params: Promise<{ rest?: string[] }> }) {
  return renderSection("__NAME__", Root, props);
}
