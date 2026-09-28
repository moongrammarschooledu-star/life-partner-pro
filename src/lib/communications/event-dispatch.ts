import { prisma } from "@/lib/prisma";
import type { Locale, NotificationChannel, NotificationType } from "@prisma/client";
import { describeNotification } from "@/lib/communications/classify";
import { communicate, type CommunicateResult } from "@/lib/communications/send-service";
import { COMMUNICATION_VARIABLES, TemplateRenderError, extractVariables, renderTemplate, toHtmlEmail } from "@/lib/communications/secure-renderer";
import { buildTemplateValues } from "@/lib/communications/template-values";
import { resolveTemplate } from "@/lib/notifications/template-resolver";

// Event-driven external delivery: this is what `sendNotification()` calls for an applicant after the in-app notification exists.
//   event -> template (ACTIVE admin-approved CommunicationTemplate bound to the event, else the built-in / legacy template)
//         -> SecureTemplateRenderer -> CommunicationPolicyEngine (inside communicate()) -> encrypted queue row -> provider.
// Every check the platform already made (essential vs optional types, per-channel preference and consent, the channel switches)
// still applies - the policy engine re-uses them - and the new ones (suppression, frequency, jurisdiction, quiet hours, provider
// eligibility, environment guard) are added on top.

const EXTERNAL_CHANNELS: NotificationChannel[] = ["EMAIL", "SMS", "WHATSAPP"];

export interface EventDispatchInput {
  profileId: string;
  type: NotificationType;
  language: Locale;
  relatedProposalId?: string | null;
  templateVars?: Record<string, string>;
  isTest?: boolean;
}

interface ChosenContent {
  body: string;
  subject: string | null;
  html: string | null;
  template: { id: string; version: number } | null;
  params: string[];
}

// The other party's contact details, so a message about a proposal can be checked against ever mentioning them (defence in depth).
export async function otherPartyContact(profileId: string, proposalId: string | null | undefined): Promise<string[]> {
  if (!proposalId) return [];
  try {
    const proposal = await prisma.proposal.findUnique({ where: { id: proposalId }, select: { profileAId: true, profileBId: true } });
    if (!proposal) return [];
    const otherId = proposal.profileAId === profileId ? proposal.profileBId : proposal.profileAId;
    if (!otherId || otherId === profileId) return [];
    const c = await prisma.contactInfo.findUnique({ where: { profileId: otherId }, select: { mobileNumber: true, whatsappNumber: true, email: true } });
    return c ? [c.mobileNumber, c.whatsappNumber ?? "", c.email].filter(Boolean) : [];
  } catch {
    return [];
  }
}

export async function findActiveEventTemplate(type: NotificationType, channel: NotificationChannel, language: Locale) {
  const wanted = await prisma.communicationTemplate.findFirst({ where: { eventKey: type, channel, language, status: "ACTIVE" }, orderBy: { currentVersion: "desc" } });
  if (wanted || language === "EN") return wanted;
  return prisma.communicationTemplate.findFirst({ where: { eventKey: type, channel, language: "EN", status: "ACTIVE" }, orderBy: { currentVersion: "desc" } });
}

export async function dispatchEventToExternalChannels(input: EventDispatchInput): Promise<CommunicateResult[]> {
  const { profileId, type, language } = input;
  const desc = describeNotification(type);
  const results: CommunicateResult[] = [];
  let values: Awaited<ReturnType<typeof buildTemplateValues>> | null = null;
  let protectedStrings: string[] | null = null;

  for (const channel of EXTERNAL_CHANNELS) {
    let chosen: ChosenContent | null = null;

    const template = await findActiveEventTemplate(type, channel, language).catch(() => null);
    if (template) {
      try {
        values ??= await buildTemplateValues(profileId, { proposalId: input.relatedProposalId });
        const usedNames = extractVariables(`${template.subject ?? ""}\n${template.body}`);
        const rendered = renderTemplate({ subject: template.subject, body: template.body, values, allowed: COMMUNICATION_VARIABLES, protectedStrings: (protectedStrings ??= await otherPartyContact(profileId, input.relatedProposalId)) });
        chosen = {
          body: rendered.text,
          subject: rendered.subject,
          html: channel === "EMAIL" ? rendered.html : null,
          template: { id: template.id, version: template.activeVersion ?? template.currentVersion },
          params: usedNames.map((n) => (values as Record<string, string | undefined>)[n] ?? ""),
        };
      } catch (error) {
        // A template that cannot be rendered safely is never sent half-rendered: fall back to the built-in copy.
        if (!(error instanceof TemplateRenderError)) throw error;
        console.error(`[communications] template ${template.templateCode} not usable for ${type}/${channel}: ${error.code}`);
      }
    }

    if (!chosen) {
      // WhatsApp is template-only (official API): with no approved template bound to this event there is nothing to send.
      if (channel === "WHATSAPP") continue;
      const legacy = await resolveTemplate(type, channel, language, input.templateVars ?? {});
      chosen = { body: legacy.body, subject: legacy.subject ?? null, html: channel === "EMAIL" ? toHtmlEmail(legacy.body) : null, template: null, params: [] };
    } else if (channel === "WHATSAPP" && !["APPROVED", "ACTIVE"].includes(template?.providerStatus ?? "")) {
      continue;
    }

    results.push(
      await communicate({
        intent: { recipient: { type: "PROFILE", profileId }, channel, messageType: desc.messageType, purpose: desc.purpose, eventKey: type, automated: true, proposalId: input.relatedProposalId ?? null },
        body: chosen.body,
        subject: chosen.subject,
        html: chosen.html,
        templateParams: chosen.params,
        template: chosen.template,
        isTest: input.isTest ?? false,
        protectedStrings: (protectedStrings ??= await otherPartyContact(profileId, input.relatedProposalId)),
      })
    );
  }
  return results;
}
