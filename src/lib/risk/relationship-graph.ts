import { prisma } from "@/lib/prisma";
import { logPrivacyAccess } from "@/lib/privacy/access-log";
import type { AccountRelationshipType, DuplicateConfidenceBand } from "@prisma/client";

// AccountRelationshipService — admin-only, bounded relationship traversal.
// Nodes expose profileCode + lifecycle status only: never name, contact
// details, photo or any sensitive trait. Depth and node count are hard-capped
// so a well-connected profile can never make this an expensive or
// data-harvesting query.

export const MAX_GRAPH_DEPTH = 2;
export const MAX_GRAPH_NODES = 40;

export interface GraphNode {
  profileId: string;
  profileCode: string;
  status: string;
  depth: number;
}
export interface GraphEdge {
  a: string;
  b: string;
  type: AccountRelationshipType;
  band: DuplicateConfidenceBand | null;
}
export interface RelationshipGraph {
  rootProfileId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
}

export async function getRelationshipGraph(rootProfileId: string, opts: { actorAdminId: string; depth?: number }): Promise<RelationshipGraph> {
  const maxDepth = Math.min(Math.max(opts.depth ?? 1, 1), MAX_GRAPH_DEPTH);
  const depthOf = new Map<string, number>([[rootProfileId, 0]]);
  const edges = new Map<string, GraphEdge>();
  let frontier = [rootProfileId];
  let truncated = false;

  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const rows = await prisma.accountRelationship.findMany({
      where: { status: "ACTIVE", OR: [{ profileId: { in: frontier } }, { relatedProfileId: { in: frontier } }] },
      select: { profileId: true, relatedProfileId: true, relationshipType: true, confidenceBand: true },
      take: MAX_GRAPH_NODES * 3,
    });
    const next: string[] = [];
    for (const r of rows) {
      for (const other of [r.profileId, r.relatedProfileId]) {
        if (!depthOf.has(other)) {
          if (depthOf.size >= MAX_GRAPH_NODES) {
            truncated = true;
            continue;
          }
          depthOf.set(other, depth);
          next.push(other);
        }
      }
      if (depthOf.has(r.profileId) && depthOf.has(r.relatedProfileId)) {
        const [a, b] = [r.profileId, r.relatedProfileId].sort();
        edges.set(`${a}|${b}|${r.relationshipType}`, { a, b, type: r.relationshipType, band: r.confidenceBand });
      }
    }
    frontier = next;
  }

  const profiles = await prisma.profile.findMany({ where: { id: { in: [...depthOf.keys()] } }, select: { id: true, profileCode: true, status: true } });
  const nodes: GraphNode[] = profiles.map((p) => ({ profileId: p.id, profileCode: p.profileCode, status: p.status, depth: depthOf.get(p.id) ?? 0 }));

  await logPrivacyAccess({ actorAdminId: opts.actorAdminId, action: "RELATIONSHIP_GRAPH_VIEWED", field: "duplicateCluster", targetProfileId: rootProfileId, purpose: "FRAUD_PREVENTION" });
  return { rootProfileId, nodes, edges: [...edges.values()], truncated };
}
