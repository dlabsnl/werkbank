// Groups can sit inside groups. They stay one flat list (L.groups) with an optional `parent` id, so the saved layout,
// undo and every lookup keep working; this file turns that list into the tree the sidebar draws. A parent that does
// not exist (or a loop in a hand-edited layout.json) shows the group at the top level.

// The groups in sidebar order: each one followed by its subgroups.
/** @param {Group[]} groups @returns {{ g: Group, depth: number }[]} */
function groupTree(groups) {
  const ids = new Set(groups.map((g) => g.id)), seen = new Set();
  /** @type {{ g: Group, depth: number }[]} */
  const out = [];
  /** @param {Group[]} list @param {number} depth */
  const walk = (list, depth) => {
    for (const g of list) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      out.push({ g, depth });
      walk(groups.filter((c) => c.parent === g.id), depth + 1);
    }
  };
  walk(groups.filter((g) => !g.parent || !ids.has(g.parent)), 0);
  walk(groups, 0); // what a loop left out
  return out;
}

// A group and everything below it.
/** @param {Group[]} groups @param {Group} g @returns {Group[]} */
function subtree(groups, g) {
  const out = [g];
  for (let i = 0; i < out.length; i++) for (const c of groups) if (c.parent === out[i].id && !out.includes(c)) out.push(c);
  return out;
}

// The groups above g, nearest first.
/** @param {Group[]} groups @param {Group} g @returns {Group[]} */
function ancestors(groups, g) {
  /** @type {Group[]} */
  const out = [];
  let id = g.parent;
  while (id) {
    const p = groups.find((x) => x.id === id);
    if (!p || p === g || out.includes(p)) break;
    out.push(p);
    id = p.parent;
  }
  return out;
}

// "Mistlampen/dev": what `werkbank list` shows and `--group` takes.
/** @param {Group[]} groups @param {Group} g */
const groupPath = (groups, g) => [...ancestors(groups, g).reverse(), g].map((x) => x.name).join('/');

// A locked group keeps its own terminals and everything inside it.
/** @param {Group[]} groups @param {Group} g */
const isLocked = (groups, g) => [g, ...ancestors(groups, g)].some((x) => x.locked);

// Is g the group `top` or somewhere below it?
/** @param {Group[]} groups @param {Group} g @param {Group} top */
const inside = (groups, g, top) => subtree(groups, top).includes(g);

// Moves a group next to another one ('before' / 'after': same level) or into it ('into': its last subgroup).
// The caller has checked that the target is not inside the moving group.
/** @param {Group[]} groups @param {Group} moving @param {Group} target @param {string} side */
function moveGroup(groups, moving, target, side) {
  groups.splice(groups.indexOf(moving), 1);
  if (side === 'into') {
    moving.parent = target.id;
    groups.push(moving);
    return;
  }
  moving.parent = target.parent;
  groups.splice(groups.indexOf(target) + (side === 'after' ? 1 : 0), 0, moving);
}
