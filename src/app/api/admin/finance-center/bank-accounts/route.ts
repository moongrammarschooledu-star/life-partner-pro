import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";

// Spec §43 — the receiving account(s) shown to a payer during Manual/Bank
// Transfer checkout (see src/lib/finance/providers/manual-provider.ts).
// Without at least one active row here, Manual checkout has no real
// destination to show — this is genuinely required for that provider to work.
export async function GET() {
  try {
    await requireAdmin("finance:packages:view");
    const items = await prisma.bankAccount.findMany({ orderBy: { displayOrder: "asc" } });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("finance:packages:manage");
    const { accountTitle, accountNumber, bankName, branchName, iban } = (await req.json()) as {
      accountTitle?: string; accountNumber?: string; bankName?: string; branchName?: string; iban?: string;
    };

    if (!accountTitle?.trim()) throw new ApiError(400, "Account title is required.");
    if (!accountNumber?.trim()) throw new ApiError(400, "Account number is required.");
    if (!bankName?.trim()) throw new ApiError(400, "Bank name is required.");

    const maxOrder = await prisma.bankAccount.aggregate({ _max: { displayOrder: true } });
    const account = await prisma.bankAccount.create({
      data: {
        accountTitle: accountTitle.trim(),
        accountNumber: accountNumber.trim(),
        bankName: bankName.trim(),
        branchName: branchName?.trim() || null,
        iban: iban?.trim() || null,
        displayOrder: (maxOrder._max.displayOrder ?? 0) + 1,
        createdById: admin.id,
      },
    });

    return NextResponse.json(account);
  } catch (error) {
    return handleApiError(error);
  }
}
