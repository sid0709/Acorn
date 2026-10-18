/**
 * The serialized page: one node per element that matters, numbered `nodeId` in document order.
 * This is Oak's `DomNode` (Oak/extension/src/types.ts), unchanged.
 */
export interface DomNode {
  nodeId: number;
  tag: string;
  id?: string;
  classes?: string[];
  attrs?: Record<string, string>;
  text?: string;
  childCount: number;
  children: DomNode[];
}
