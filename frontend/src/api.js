export async function streamPermissions(projectId, connectionId, onLog) {
  const response = await fetch(`/api/check-lb-permissions/stream?connection_id=${encodeURIComponent(connectionId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_id: projectId }),
  });
  if (response.status === 401 && !response.url?.includes("/auth/")) window.dispatchEvent(new Event("session-expired"));
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || "Permission check failed.");
  }
  return consumeSse(response, onLog);
}

export async function streamScan(projectId, connectionId, onLog) {
  const response = await fetch(
    `/api/v1/scan/${encodeURIComponent(projectId)}/stream?connection_id=${encodeURIComponent(connectionId)}`
  );
  if (response.status === 401 && !response.url?.includes("/auth/")) window.dispatchEvent(new Event("session-expired"));
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || "Scan failed.");
  }
  return consumeSse(response, onLog);
}

async function consumeSse(response, onLog) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";

    for (const chunk of chunks) {
      const line = chunk.split("\n").find((entry) => entry.startsWith("data: "));
      if (!line) continue;

      const payload = JSON.parse(line.slice(6));
      if (payload.type === "log") onLog?.(payload.message);
      else if (payload.type === "result") return payload.data;
      else if (payload.type === "error") throw new Error(payload.message);
    }
  }

  throw new Error("Stream ended before a result was received.");
}

export async function authRequest(path, options = {}) {
  let response;
  try { response = await fetch(`/api/auth/${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-CloudScanner-Request': '1' },
  }); } catch { throw new Error('Cannot reach the sign-in service. Please try again shortly.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    let message;
    if (response.status === 503 && data.detail === 'Account database is unavailable. Please try again later.') message = 'Cannot connect to the account database. Please try again shortly.';
    else if (response.status === 503 && typeof data.detail === 'string') message = data.detail;
    else if (response.status >= 500) message = 'The sign-in service is unavailable. Please try again shortly.';
    else if (response.status === 404) message = 'The sign-in service is not available on this server.';
    else if (typeof data.detail === 'string') message = data.detail;
    else if (response.status === 422) message = path === 'profile' ? 'Enter a valid name.' : 'Please check your request and try again.';
    else message = 'Unable to complete your request. Please try again.';
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}
export const beginGoogleSignIn = () => authRequest('google/start', { method: 'POST' });
export const loginDemo = () => authRequest('demo', { method: 'POST' });
export const currentUser = () => authRequest('me');
export const signOut = () => authRequest('logout', { method: 'POST' });
export const updateProfile = values => authRequest('profile', { method: 'PATCH', body: JSON.stringify(values) });

export async function cloudRequest(path, options = {}) {
  const response = await fetch(`/api/${path}`, {
    credentials: 'same-origin', ...options,
    headers: { 'Content-Type': 'application/json', 'X-CloudScanner-Request': '1' },
  });
  if (response.status === 401) window.dispatchEvent(new Event('session-expired'));
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Unable to access cloud connections.');
  return data;
}
export const fetchConnections = () => cloudRequest('connections');
export const fetchWorkspaces = () => cloudRequest('workspaces');
export const connectGcp = workspaceId => cloudRequest(`workspaces/${encodeURIComponent(workspaceId)}/connections/gcp/start`, { method: 'POST' });
export const disconnectCloud = id => cloudRequest(`connections/${encodeURIComponent(id)}`, { method: 'DELETE' });
