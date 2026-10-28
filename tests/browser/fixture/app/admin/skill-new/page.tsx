import { ContentWorkbench } from "@/components/admin/content-workbench";
export default function Page() {
  return <section className="p-6"><h1>新建 Skill 介绍</h1><ContentWorkbench initialType="skill" series={[]} /></section>;
}
