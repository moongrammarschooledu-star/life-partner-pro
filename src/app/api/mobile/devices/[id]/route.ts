import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/route-guard";
import { mobileGuard } from "@/lib/mobile/route-guard";
import { removeDevice, updateDeviceSettings } from "@/lib/mobile/device-service";

export const dynamic = "force-dynamic";

// Remove one of the person's own devices: its push token is deleted and the session it used is signed out. Someone else's id answers 404.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await mobileGuard(req, "mobile-device", { limit: 30, windowMs: 60_000 }, { write: true });
    if ("response" in g) return g.response;
    const { id } = await params;
    return NextResponse.json(await removeDevice(g.actor, id));
  } catch (error) {
    return handleApiError(error);
  }
}

// Notification display mode ("FULL" | "PRIVATE" | "MINIMAL" | "OFF", or null to follow the account) and biometric lock for one device.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await mobileGuard(req, "mobile-device", { limit: 30, windowMs: 60_000 }, { write: true });
    if ("response" in g) return g.response;
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as { displayMode?: unknown; biometricEnabled?: unknown } | null;
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    return NextResponse.json({ device: await updateDeviceSettings(g.actor, id, body) });
  } catch (error) {
    return handleApiError(error);
  }
}