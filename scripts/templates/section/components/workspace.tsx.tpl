"use client";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, usePersistentState } from "@/sections/_sdk";
import styles from "../styles.module.css";

/** 示例交互：进度保存在读者本机；替换为栏目的实际内容。 */
export function Workspace({ step, signedIn }: { step: string | null; signedIn: boolean }) {
  const [count, setCount] = usePersistentState("__NAME__", "count", 0);
  return (
    <Card className={styles.stage}>
      <CardHeader>
        <CardTitle>开始</CardTitle>
        <CardDescription>
          {step ? `当前子路径：${step}` : "这是栏目模板，可直接替换。"}
          {signedIn ? " 已登录。" : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-3">
        <Button onClick={() => setCount((value) => value + 1)}>已练习 {count} 次</Button>
        <Button variant="ghost" onClick={() => setCount(0)}>
          重置
        </Button>
      </CardContent>
    </Card>
  );
}
