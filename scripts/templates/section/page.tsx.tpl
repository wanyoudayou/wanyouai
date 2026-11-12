import { SectionBody, SectionHeader, type SectionProps } from "@/sections/_sdk";
import { Workspace } from "./components/workspace";
import styles from "./styles.module.css";

/** 栏目根组件：服务端渲染外层，交互部分放在 components/ 的客户端组件中。 */
export default function Root({ path, viewer }: SectionProps) {
  return (
    <SectionBody className={styles.root}>
      <SectionHeader title="__TITLE__" description="__DESCRIPTION__" />
      <Workspace step={path[0] ?? null} signedIn={viewer.loggedIn} />
    </SectionBody>
  );
}
