/** Pure post-login owner gate. Existing owners are independent of bootstrap config. */
export type OwnerBootstrapUser = {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
};

export type OwnerBootstrapGateway = {
  isOwner(): Promise<boolean>;
  claim(userId: string, expectedEmail: string): Promise<boolean>;
};

export type OwnerBootstrapOutcome =
  | "owner"
  | "claimed"
  | "unverified"
  | "unconfigured"
  | "not_allowed"
  | "already_claimed";

export async function ensureOwnerAfterLogin(
  user: OwnerBootstrapUser | null,
  expectedEmail: string | undefined,
  gateway: OwnerBootstrapGateway,
): Promise<OwnerBootstrapOutcome> {
  if (!user?.id || !user.email || !user.email_confirmed_at) return "unverified";
  if (await gateway.isOwner()) return "owner";
  const configured = expectedEmail?.trim().toLowerCase();
  if (!configured) return "unconfigured";
  if (user.email.trim().toLowerCase() !== configured) return "not_allowed";
  return (await gateway.claim(user.id, configured)) ? "claimed" : "already_claimed";
}
