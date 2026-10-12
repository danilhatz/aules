const KEY = 'aules.session';

const aborted = () => Object.assign(new Error('aborted'), { code: 'aborted' });

export function createAuth({ storage, api, vault = null }) {
  // Bumped by logout(); in-flight logins/renewals that started earlier must not write a session back.
  let epoch = 0;

  async function establish(username, password, startEpoch) {
    const token = await api.requestToken(username, password);
    const info = await api.getSiteInfo(token);
    if (startEpoch !== epoch) throw aborted();
    const session = { token, userid: info.userid, fullname: info.fullname };
    storage.setItem(KEY, JSON.stringify(session));
    return session;
  }
  return {
    async login(username, password) {
      const session = await establish(username, password, epoch);
      if (vault) await vault.save(username, password);
      return session;
    },
    // Silent token renewal from the saved credentials. null = nothing saved.
    async relogin() {
      if (!vault) return null;
      const startEpoch = epoch;
      const creds = await vault.load();
      if (!creds) return null;
      if (startEpoch !== epoch) throw aborted();
      try {
        return await establish(creds.username, creds.password, startEpoch);
      } catch (err) {
        if (err && err.code === 'invalidlogin') await vault.clear();
        throw err;
      }
    },
    getSession() {
      try {
        const s = JSON.parse(storage.getItem(KEY));
        return s && s.token && s.userid != null ? s : null;
      } catch {
        return null;
      }
    },
    epoch: () => epoch,
    logout() {
      epoch += 1;
      storage.removeItem(KEY);
      return vault ? vault.clear() : Promise.resolve();
    },
  };
}
