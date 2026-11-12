import { InquiryForm } from "@/components/service/inquiry-form";
export default function Page() {
  return <div className="mx-auto w-full max-w-3xl min-w-0 p-4">
    <h1 className="mb-5 text-2xl font-semibold">服务询价</h1>
    <InquiryForm slug="synthetic-service" loggedIn={false} turnstileSiteKey="synthetic-site-key-a" />
  </div>;
}
