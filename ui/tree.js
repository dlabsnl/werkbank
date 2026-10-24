// Split tree of the window. Node: { id } (a pane) or { dir: 'row' | 'col', ratio, a, b }
// (row = side by side, col = stacked; ratio = share of `a`).

/** @type {(n: TreeNode | null) => string[]} */
const leaves = (n) => (!n ? [] : 'id' in n ? [n.id] : [...leaves(n.a), ...leaves(n.b)]);

// Removes a pane; its sibling takes the parent's place.
/** @param {TreeNode | null} n @param {string} id @returns {TreeNode | null} */
function without(n, id) {
  if (!n) return null;
  if ('id' in n) return n.id === id ? null : n;
  const a = without(n.a, id), b = without(n.b, id);
  if (!a) return b;
  if (!b) return a;
  n.a = a;
  n.b = b;
  return n;
}

// Splits pane `target` in two, putting `id` after it (or before it).
/** @param {TreeNode} n @param {string} target @param {string} id @param {'row' | 'col'} dir @param {boolean} before @returns {TreeNode} */
function splitAt(n, target, id, dir, before, ratio = 0.5) {
  if ('id' in n) return n.id === target ? { dir, ratio, a: before ? { id } : n, b: before ? n : { id } } : n;
  n.a = splitAt(n.a, target, id, dir, before, ratio);
  n.b = splitAt(n.b, target, id, dir, before, ratio);
  return n;
}

// Swaps two panes; the splits stay as they are.
/** @type {(n: TreeNode | null, x: string, y: string) => TreeNode | null} */
const swap = (n, x, y) => (!n ? n : 'id' in n ? (n.id === x ? { id: y } : n.id === y ? { id: x } : n)
  : { ...n, a: /** @type {TreeNode} */ (swap(n.a, x, y)), b: /** @type {TreeNode} */ (swap(n.b, x, y)) });

// Where a pane sits, to put it back there later: a neighbour (first pane of the other half of its split), the
// split direction, whether it came before the neighbour, and the split ratio. null if it is alone or not found.
/** @param {TreeNode | null} n @param {string} id @returns {Spot | null} */
function spotOf(n, id) {
  if (!n || 'id' in n) return null;
  for (const [mine, other, before] of /** @type {const} */ ([[n.a, n.b, true], [n.b, n.a, false]])) {
    if ('id' in mine && mine.id === id) return { sibling: leaves(other)[0], dir: n.dir, before, ratio: n.ratio };
  }
  return spotOf(n.a, id) || spotOf(n.b, id);
}

// Fixed grid: up to 3 side by side, more in two rows of columns (4 = 2x2, 6 = 3 columns of 2, 8 = 4 columns of 2).
/** @param {string[]} ids @returns {TreeNode} */
function grid(ids) {
  /** @type {(nodes: TreeNode[], dir: 'row' | 'col') => TreeNode} */
  const chain = (nodes, dir) => (nodes.length === 1 ? nodes[0]
    : { dir, ratio: 1 / nodes.length, a: nodes[0], b: chain(nodes.slice(1), dir) });
  const rows = ids.length <= 3 ? 1 : 2, cols = [];
  for (let i = 0; i < ids.length; i += rows) cols.push(chain(ids.slice(i, i + rows).map((id) => ({ id })), 'col'));
  return chain(cols, 'row');
}
