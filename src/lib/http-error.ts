// Dependency-free base class shared by ApiError (src/lib/route-guard.ts) and
// WorkflowError (src/lib/workflow/engine.ts) so handleApiError() can
// recognize both via one `instanceof` check without either error class's
// home module needing to import the other. route-guard.ts's auth.ts import
// chain pulls in NextAuth; engine.ts is transitively imported by
// admin-tasks.ts, which many lightweight, NextAuth-free modules import — a
// direct route-guard.ts import from engine.ts previously dragged that whole
// chain into every one of them.
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
