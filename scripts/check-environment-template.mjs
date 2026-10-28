export function assertNoCredentialTokens(template) {
  // Bare format prefixes are useful instructions; populated tokens are forbidden,
  // including in comments. Never include the matched value in an error.
  if (/(?:sb_secret_|sb_publishable_|re_)[A-Za-z0-9_-]+/.test(template)) {
    throw new Error(".env.example contains a credential-like token");
  }
}
