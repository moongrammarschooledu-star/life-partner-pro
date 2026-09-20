import { AsyncLocalStorage } from "async_hooks";

// Per-request context for instrumented routes so slow-query and latency
// records can be attributed to an endpoint (best-effort; Prisma query events
// may not always propagate the store, in which case route is "-").
export interface RequestContext {
  route: string;
  correlationId?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();
