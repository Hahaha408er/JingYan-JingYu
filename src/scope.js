

export function isGroup(key) {
  return String(key || '').startsWith('group:');
}

export function gidOf(key) {
  const k = String(key || '');
  return k.startsWith('group:') ? k.slice('group:'.length) : '';
}

export function groupCfg(key, cfg = {}) {
  const gid = gidOf(key);
  if (!gid) return {};
  const all = cfg.groups || {};
  return all[gid] || {};
}

export function adminsOf(key, cfg = {}) {
  const out = new Set((cfg.ownerIds || []).map(String));
  for (const a of (groupCfg(key, cfg).admins || [])) {
    const s = String(a || '').trim();
    if (s) out.add(s);
  }
  return out;
}

export function isAdminIn(key, uid, cfg = {}) {
  const id = String(uid || '').trim();
  return !!id && adminsOf(key, cfg).has(id);
}

export function groupWakeCfg(key, cfg = {}) {
  const g = groupCfg(key, cfg);
  const w = cfg.wake || {};
  const atOnly = w.groupAtOnly !== false;
  return {
    mode: g.mode === 'active' ? 'active' : (g.mode === 'diving' ? 'diving' : 'diving'),
    atMention: true,
    nameMention: g.nameMention ?? !atOnly,
    question: g.question ?? !atOnly,
    poke: g.poke ?? true,
    probability: Number(g.probability ?? w.probability ?? 0) || 0,
    speakerIds: Array.isArray(g.speakerIds) ? g.speakerIds : undefined,
  };
}
