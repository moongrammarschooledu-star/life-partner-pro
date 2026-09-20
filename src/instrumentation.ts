import type { Instrumentation } from "next";

// Next.js instrumentation hook (spec §13/§53). register() runs once per server
// instance; onRequestError receives every uncaught server error (route
// handlers and server-component renders) and feeds the central error store.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runStartupChecks } = await import("@/lib/ops/startup");
    await runStartupChecks();
  }
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { captureError } = await import("@/lib/observability/error-capture");
  const cid = request.headers["x-correlation-id"];
  await captureError({
    error,
    route: request.path.split("?")[0],
    service: context.routeType === "route" ? "API" : "RENDER",
    correlationId: Array.isArray(cid) ? cid[0] : cid,
  });
};
