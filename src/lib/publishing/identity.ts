/** A publisher's authenticated identity is separate from the resource it may edit. */
export type PublisherIdentity =
  | { kind: "owner"; ownerId: string }
  | { kind: "legacy-publisher" }
  | { kind: "handbook"; ownerId: string; credentialId: string };

export function publisherCanEdit(identity: PublisherIdentity, target: { type: string; scope: string }) {
  if (identity.kind !== "handbook") return true;
  return target.type === "handbook" && /^series:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(target.scope);
}
