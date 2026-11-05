export interface AccountConsent {
  category: string;
  version: string;
  required: boolean;
}
export declare const ACCOUNT_CONSENTS: readonly AccountConsent[];
export declare function checkConsents(sent: unknown): { ok: AccountConsent[]; missing: string[] };
