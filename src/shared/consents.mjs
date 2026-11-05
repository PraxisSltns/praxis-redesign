/**
 * The consents an account is created with, shared by the sign-in form (src/a/ui/GateSteps.tsx) and the
 * server (server/auth), so both name the same versions. Sign-up records each one in the consents table
 * with its version; a new version means asking again.
 *
 * The wording isn't legally approved yet (docs/integration-dependencies.md, "Legal approval"), so the
 * versions say draft. Change the version whenever the text the customer agrees to changes.
 */
export const ACCOUNT_CONSENTS = [
  { category: "terms", version: "terms-draft-2026-11", required: true },
  { category: "privacy", version: "privacy-draft-2026-11", required: true },
];

/** The consents a sign-in form sent that match the current versions, or the required ones it's missing. */
export function checkConsents(sent) {
  const given = Array.isArray(sent) ? sent : [];
  const ok = ACCOUNT_CONSENTS.filter((c) => given.some((g) => g && g.category === c.category && g.version === c.version));
  const missing = ACCOUNT_CONSENTS.filter((c) => c.required && !ok.includes(c)).map((c) => c.category);
  return { ok, missing };
}
