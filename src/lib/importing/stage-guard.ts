type Check = { hash: string; updatedAt: string | null; onlineChanged: boolean; change?: string };
type Operation = { checkedHash?: string; updatedAt: string | null; overwriteOnline?: boolean };
export function handbookStageProblem(check: Check, operation: Operation | undefined, draftUpload: boolean) {
  if (!operation || operation.checkedHash !== check.hash) return "PREVIEW_CHANGED";
  if (operation.updatedAt !== check.updatedAt) return "ONLINE_CHANGED";
  if ((check.onlineChanged || (draftUpload && ["changed", "existing"].includes(check.change ?? ""))) && !(draftUpload && operation.overwriteOnline)) return "OVERWRITE_CONFIRMATION_REQUIRED";
  return null;
}
