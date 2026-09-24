// Stands in for the PostgreSQL driver at its boundary: every query is recorded on globalThis and
// answered with the rows the test put there.
const state = (globalThis.__fakePg ??= { queries: [], rows: [{ id: 7 }], pools: [] });

class Pool {
  constructor(options) {
    state.pools.push(options);
  }
  on() {
    return this;
  }
  async query(sql, values) {
    state.queries.push({ sql, values });
    return { rows: state.rows };
  }
  async end() {}
}

export default { Pool };
