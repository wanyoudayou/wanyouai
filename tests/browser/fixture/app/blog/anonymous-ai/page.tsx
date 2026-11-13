import { HeroActions } from "@/components/home/hero-actions";

export default function Page() {
  return <section className="p-6">
    <h1>分身发送交互夹具</h1>
    <HeroActions subscribe={{ enabled: false, label: null }} chat={{ enabled: true, label: null }} />
  </section>;
}
