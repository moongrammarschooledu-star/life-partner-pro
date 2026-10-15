// Since STEP 38 an e-mail address is optional: the mobile number is the primary contact. A person who never gave an e-mail address cannot verify one, and must not be
// held at a lower verification level or completeness for it. "Met" therefore means: verified, or there is nothing to verify.
export function emailRequirementMet(verifiedAt: Date | null | undefined, email: string | null | undefined): boolean {
  return !!verifiedAt || !email?.trim();
}
