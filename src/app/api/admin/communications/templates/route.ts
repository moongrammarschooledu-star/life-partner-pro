import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { createTemplate, listTemplates } from "@/lib/communications/template-service";
import { CHANNELS, LOCALES, MESSAGE_TYPES, PURPOSES, oneOf, optionalOneOf, readJson, str, takeParam } from "@/lib/communications/route-utils";
import { COMMUNICATION_VARIABLES } from "@/lib/communications/secure-renderer";

export async function GET(req: Request) {
  try {
    await requireAdmin("communications:templates:view");
    const q = new URL(req.url).searchParams;
    const items = await listTemplates({
      channel: optionalOneOf(q.get("channel"), CHANNELS, "channel"),
      language: optionalOneOf(q.get("language"), LOCALES, "language"),
      status: q.get("status") ?? undefined,
      take: takeParam(q.get("take"), 100),
    });
    return NextResponse.json({ items, allowedVariables: COMMUNICATION_VARIABLES });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("communications:templates:create");
    const body = await readJson(req);
    const template = await createTemplate(admin, {
      name: str(body.name, "name", { max: 120 }),
      channel: oneOf(body.channel, CHANNELS, "channel"),
      messageType: oneOf(body.messageType, MESSAGE_TYPES, "messageType"),
      purpose: oneOf(body.purpose, PURPOSES, "purpose"),
      language: oneOf(body.language, LOCALES, "language"),
      eventKey: str(body.eventKey, "eventKey", { max: 80, optional: true }) || null,
      subject: str(body.subject, "subject", { max: 300, optional: true }) || null,
      body: str(body.body, "body", { max: 4000 }),
    });
    return NextResponse.json(template, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
