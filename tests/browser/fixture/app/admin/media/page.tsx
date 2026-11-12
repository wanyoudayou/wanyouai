import { MediaBrowser } from "@/components/admin/media-library";
export default function Page() {
  return (
    <section className="min-w-0 p-4">
      <h1 className="mb-5 text-2xl">素材库</h1>
      <MediaBrowser standalone />
    </section>
  );
}
