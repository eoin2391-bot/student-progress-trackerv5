const Api = (() => {
  function tokenKey(role) { return role + 'Token'; }

  function getToken(role) { return localStorage.getItem(tokenKey(role)); }
  function setToken(role, token) { localStorage.setItem(tokenKey(role), token); }
  function clearToken(role) { localStorage.removeItem(tokenKey(role)); }

  async function req(role, method, url, body, isFileUpload) {
    const headers = {};
    const token = getToken(role);
    if (token) headers.Authorization = 'Bearer ' + token;
    let payload = body;
    if (body && !isFileUpload) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(url, { method, headers, body: payload });
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  return {
    getToken, setToken, clearToken,
    get: (role, url) => req(role, 'GET', url),
    post: (role, url, body, isFileUpload) => req(role, 'POST', url, body, isFileUpload),
    put: (role, url, body) => req(role, 'PUT', url, body),
    patch: (role, url, body) => req(role, 'PATCH', url, body),
    del: (role, url) => req(role, 'DELETE', url)
  };
})();
