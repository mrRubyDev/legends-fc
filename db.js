// Small Firestore-style wrapper over one Supabase table (legends_docs),
// so the app can call db.collection(...).onSnapshot / db.doc(...).set etc.
window.LegendsDB = function (url, key) {
  const sb = supabase.createClient(url, key);
  const T = "legends_docs";
  const cache = {};      // coll -> Map(id -> data)
  const loading = {};    // coll -> Promise
  const colL = {};       // coll -> [listener]
  const docL = {};       // "coll/id" -> [listener]
  let adminCode = null;

  const snap = c => ({ docs: [...(cache[c] || new Map())].map(([id, d]) => ({ id, data: () => d })) });
  const docSnap = (c, id) => { const d = cache[c] && cache[c].get(id); return { exists: !!d, data: () => d } };
  function emit(c) {
    (colL[c] || []).forEach(f => f(snap(c)));
    for (const k in docL) { const [cc, id] = k.split("/"); if (cc === c) docL[k].forEach(f => f(docSnap(c, id))) }
  }
  function load(c, force) {
    if (loading[c] && !force) return loading[c];
    return loading[c] = (async () => {
      const { data, error } = await sb.from(T).select("id,data").eq("coll", c).limit(5000);
      if (error) { delete loading[c]; throw error }
      cache[c] = new Map(data.map(r => [r.id, r.data]));
      emit(c);
    })();
  }
  const reloadAll = () => Object.keys(loading).forEach(c => load(c, true).catch(console.error));

  // Live updates from other devices.
  sb.channel("legends").on("postgres_changes", { event: "*", schema: "public", table: T }, p => {
    const r = p.eventType === "DELETE" ? p.old : p.new;
    if (!r || !cache[r.coll]) return;
    if (p.eventType === "DELETE") cache[r.coll].delete(r.id); else cache[r.coll].set(r.id, r.data);
    emit(r.coll);
  }).subscribe(s => { if (s === "SUBSCRIBED") reloadAll() });
  // Phones pause sockets in the background: refresh when the tab comes back.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) reloadAll() });

  async function write(op, c, id, d = {}) {
    if (!adminCode) throw new Error("Només l’administrador pot fer canvis.");
    const { error } = await sb.rpc("legends_admin_write", { code: adminCode, op, p_coll: c, p_id: id, p_data: d });
    if (error) throw new Error(error.message);
    const m = cache[c] || (cache[c] = new Map());
    if (op === "delete") m.delete(id);
    else if (op === "set") m.set(id, d);
    else if (m.has(id)) m.set(id, { ...m.get(id), ...d });
    emit(c);
  }
  const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  const ref = (c, id) => ({
    id,
    set: d => write("set", c, id, d),
    update: d => write("update", c, id, d),
    delete: () => write("delete", c, id),
    onSnapshot(fn, err) {
      (docL[c + "/" + id] || (docL[c + "/" + id] = [])).push(fn);
      load(c).then(() => fn(docSnap(c, id))).catch(err || console.error);
    }
  });

  return {
    collection: c => ({
      doc: id => ref(c, id || newId()),
      onSnapshot(fn, err) { (colL[c] || (colL[c] = [])).push(fn); load(c).then(() => fn(snap(c))).catch(err || console.error) }
    }),
    doc: path => { const [c, id] = path.split("/"); return ref(c, id) },
    async vote(uid, matchId, rec) {
      const { error } = await sb.rpc("legends_vote", { p_uid: uid, p_match: matchId, p_rec: rec });
      if (error) throw new Error(error.message);
      const m = cache.votes || (cache.votes = new Map()), cur = m.get(uid) || { byMatch: {} };
      m.set(uid, { byMatch: { ...cur.byMatch, [matchId]: rec } });
      emit("votes");
    },
    async checkAdmin(code) {
      const { data, error } = await sb.rpc("legends_is_admin", { code });
      if (error) throw new Error(error.message);
      return data === true;
    },
    setAdmin(code) { adminCode = code }
  };
};
