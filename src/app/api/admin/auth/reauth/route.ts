import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { prisma } from "@/lib/prisma";
import { issueStepUpToken } from "@/lib/step-up-token";
import { enforcePersistentLimit } from "@/lib/ops/rate-limit-persistent";

// Password re-confirmation for the two most sensitive actions (spec §16):
// deactivating an admin account, and changing critical security settings.
// Returns a 5-minute signed token the caller must send back on the actual
// mutation — see src/lib/step-up-token.ts.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    // Password-guessing guard for the step-up prompt (10 tries / 15 min per admin).
    const limited = await enforcePersistentLimit(req, "admin-reauth", 10, 15 * 60_000, admin.id);
    if (limited) return limited;
    const { password } = (await req.json()) as { password?: string };
    if (!password) throw new ApiError(400, "Password is required.");

    const record = await prisma.adminUser.findUnique({ where: { id: admin.id } });
    if (!record) throw new ApiError(401, "Unauthorized");

    const valid = await bcrypt.compare(password, record.passwordHash);
    if (!valid) throw new ApiError(403, "Incorrect password.");

    const token = issueStepUpToken("REAUTH", admin.id, 5 * 60_000);
    return NextResponse.json({ token });
  } catch (error) {
    return handleApiError(error);
  }
}
