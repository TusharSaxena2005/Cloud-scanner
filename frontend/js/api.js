export async function fetchServiceAccount() {
  const response = await fetch("/api/service-account");
  if (!response.ok) throw new Error("Unable to load service account.");
  return response.json();
}

export async function streamPermissions(projectId, onLog) {
  const response = await fetch("/api/check-lb-permissions/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_id: projectId }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || "Permission check failed.");
  }
  return consumeSse(response, onLog);
}

export async function streamScan(projectId, onLog) {
  const response = await fetch(
    `/api/v1/scan/${encodeURIComponent(projectId)}/stream`
  );
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
