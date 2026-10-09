// STEP 32 — pure detectors for AI security monitoring. They look at text a person typed into an AI feature and return a PATTERN CODE, never
// the text: the security event stores only the code, the feature name and the acting admin. Detection is advisory and non-blocking — it feeds
// the SOC rules, while the real controls (permission checks, consent, the no-action copilot, the output safety filter) stay exactly as they
// were. A match is a reason to look, not a judgement about the person.

export type InjectionPattern =
  | "IGNORE_INSTRUCTIONS"
  | "REVEAL_PROMPT"
  | "ROLE_OVERRIDE"
  | "DEVELOPER_MODE"
  | "BYPASS_ACCESS"
  | "EXFILTRATE"
  | "DELIMITER_ESCAPE";

export type RestrictedAction = "APPROVE_CONTACT_SHARING" | "OVERRIDE_CONSENT" | "GRANT_PERMISSION" | "DELETE_ACCOUNT" | "DISABLE_SECURITY";

const INJECTION: Array<[InjectionPattern, RegExp]> = [
  ["IGNORE_INSTRUCTIONS", /\b(ignore|disregard|forget|override)\b.{0,30}\b(all |the |any |your )?(previous|prior|above|earlier|system|safety)\b.{0,30}\b(instructions?|rules?|prompts?|guidelines?|polic(y|ies))\b/i],
  ["REVEAL_PROMPT", /\b(reveal|show|print|repeat|output|leak|tell me)\b.{0,30}\b(your |the )?(system|hidden|initial|original|developer)\b.{0,15}\b(prompt|instructions?|message)\b/i],
  ["ROLE_OVERRIDE", /\b(you are now|from now on you are|pretend (to be|you are)|act as (an? )?(unrestricted|admin|root|super ?admin|developer)|simulate (an? )?(unrestricted|jailbroken))\b/i],
  ["DEVELOPER_MODE", /\b(developer mode|jailbreak|dan mode|do anything now|no restrictions mode|unfiltered mode)\b/i],
  ["BYPASS_ACCESS", /\b(bypass|skip|disable|turn off|ignore)\b.{0,25}\b(permissions?|access control|authori[sz]ation|consent|safety (filter|check)|restrictions?)\b/i],
  ["EXFILTRATE", /\b(send|post|forward|upload|exfiltrate|email)\b.{0,40}\b(to|at)\b.{0,10}(https?:\/\/|[\w.+-]+@[\w-]+\.[\w.]+)/i],
  ["DELIMITER_ESCAPE", /(<\/?\s*(system|assistant|instructions?)\s*>|\[\/?(system|inst)\]|```\s*(system|instructions?))/i],
];

const RESTRICTED: Array<[RestrictedAction, RegExp]> = [
  ["APPROVE_CONTACT_SHARING", /\b(approve|allow|grant|release|share|reveal|send)\b.{0,25}\b(contact( details| info(rmation)?)?|phone( number)?|whatsapp|email address)\b/i],
  ["OVERRIDE_CONSENT", /\b(override|ignore|bypass|skip|remove|withdraw|fake)\b.{0,20}\b(consent|opt[- ]?out|suppression|do not contact)\b/i],
  ["GRANT_PERMISSION", /\b(grant|give|assign|promote|make me|elevate|add)\b.{0,25}\b(super ?admin|admin(istrator)? (role|rights|access)|permissions?|privileges?|role)\b/i],
  ["DELETE_ACCOUNT", /\b(permanently )?(delete|erase|wipe|purge|remove)\b.{0,20}\b(account|profile|user|data|records?|backups?)\b/i],
  ["DISABLE_SECURITY", /\b(disable|turn off|switch off|remove)\b.{0,20}\b(2fa|mfa|two[- ]factor|audit( log)?|security|alerts?|monitoring)\b/i],
];

export function detectPromptInjection(text: string | null | undefined): InjectionPattern | null {
  if (!text) return null;
  const t = text.length > 2000 ? text.slice(0, 2000) : text;
  for (const [code, re] of INJECTION) if (re.test(t)) return code;
  return null;
}

export function detectRestrictedActionRequest(text: string | null | undefined): RestrictedAction | null {
  if (!text) return null;
  const t = text.length > 2000 ? text.slice(0, 2000) : text;
  for (const [code, re] of RESTRICTED) if (re.test(t)) return code;
  return null;
}

// Actions the AI layer must never be able to perform. A structure test asserts no module under src/lib/ai imports the modules that would do them.
export const AI_FORBIDDEN_ACTIONS: RestrictedAction[] = ["APPROVE_CONTACT_SHARING", "OVERRIDE_CONSENT", "GRANT_PERMISSION", "DELETE_ACCOUNT", "DISABLE_SECURITY"];
