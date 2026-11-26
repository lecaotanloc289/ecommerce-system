import type { CategoryOption } from './product-form';

export interface CategoryNode {
  id: string;
  name: string;
  children: readonly CategoryNode[];
}

/** Category tree → flat list in tree order, with `depth` for indentation. */
export function flattenCategories(nodes: readonly CategoryNode[], depth = 0): CategoryOption[] {
  return nodes.flatMap((node) => [
    { id: node.id, name: node.name, depth },
    ...flattenCategories(node.children, depth + 1),
  ]);
}
