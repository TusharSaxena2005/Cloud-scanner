const form = document.getElementById("check-form");
const projectInput = document.getElementById("project-id");
const submitBtn = document.getElementById("submit-btn");
const errorBox = document.getElementById("error-box");
const resultsSection = document.getElementById("results");
const statusBadge = document.getElementById("status-badge");
const resultMessage = document.getElementById("result-message");
const metaProject = document.getElementById("meta-project");
const metaSa = document.getElementById("meta-sa");
const permissionsBody = document.getElementById("permissions-body");
const missingSection = document.getElementById("missing-section");
const missingList = document.getElementById("missing-list");
const saHint = document.getElementById("sa-hint");
const activityLog = document.getElementById("activity-log");
const activityLogBody = document.getElementById("activity-log-body");
const activityStatus = document.getElementById("activity-status");

async function loadServiceAccountInfo() {
  try {
    const response = await fetch("/api/service-account");
    if (!response.ok) {
      throw new Error("Unable to load service account info.");
    }

    const data = await response.json();
    saHint.textContent = data.unique_id
      ? `Using Application Default Credentials as ${data.email} (ID: ${data.unique_id}).`
      : `Using Application Default Credentials as ${data.email}.`;
  } catch {
    saHint.textContent =
      "ADC not configured. Run: gcloud auth application-default login";
  }
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
}

function hideError() {
  errorBox.classList.add("hidden");
  errorBox.textContent = "";
}

function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  submitBtn.textContent = isLoading ? "Checking..." : "Check Permissions";
  activityStatus.textContent = isLoading ? "Running" : "Idle";
  activityStatus.classList.toggle("running", isLoading);
}

function resetActivityLog() {
  activityLogBody.textContent = "";
  activityLog.classList.remove("hidden");
}

function appendActivityLog(message) {
  activityLog.classList.remove("hidden");
  activityLogBody.textContent += `${message}\n`;
  activityLogBody.scrollTop = activityLogBody.scrollHeight;
}

function permissionStatusClass(status) {
  if (status === "GRANTED") return "perm-granted";
  if (status === "INVALID") return "perm-invalid";
  return "perm-denied";
}

function renderPermissions(permissions) {
  permissionsBody.innerHTML = permissions
    .map(
      (item) => `
        <tr>
          <td><code>${escapeHtml(item.permission)}</code></td>
          <td>${escapeHtml(item.scope)}</td>
          <td class="${permissionStatusClass(item.status)}">
            ${escapeHtml(item.status)}
          </td>
        </tr>
      `
    )
    .join("");
}

function renderMissingPermissions(missingPermissions, invalidPermissions) {
  const notGranted = [...missingPermissions, ...invalidPermissions];

  if (!notGranted.length) {
    missingSection.classList.add("hidden");
    missingList.innerHTML = "";
    return;
  }

  missingList.innerHTML = notGranted
    .map((permission) => `<li><code>${escapeHtml(permission)}</code></li>`)
    .join("");
  missingSection.classList.remove("hidden");
}

function renderResults(data) {
  const allGranted = data.all_permissions_granted;

  statusBadge.textContent = allGranted ? "All Granted" : "Missing Permissions";
  statusBadge.className = `badge ${allGranted ? "success" : "error"}`;

  resultMessage.textContent = data.message;
  metaProject.textContent = data.project_id;
  metaSa.textContent = data.service_account_email;

  renderPermissions(data.permissions);
  renderMissingPermissions(data.missing_permissions, data.invalid_permissions);

  if (Array.isArray(data.logs)) {
    for (const line of data.logs) {
      if (!activityLogBody.textContent.includes(line)) {
        appendActivityLog(line);
      }
    }
  }

  resultsSection.classList.remove("hidden");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function consumeSseStream(response, onLog) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";

    for (const chunk of chunks) {
      const line = chunk
        .split("\n")
        .find((entry) => entry.startsWith("data: "));
      if (!line) {
        continue;
      }

      const payload = JSON.parse(line.slice(6));
      if (payload.type === "log") {
        onLog(payload.message);
      } else if (payload.type === "result") {
        return payload.data;
      } else if (payload.type === "error") {
        throw new Error(payload.message);
      }
    }
  }

  throw new Error("Stream ended before a result was received.");
}

async function checkPermissions(projectId, onLog) {
  const response = await fetch("/api/check-lb-permissions/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_id: projectId }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const detail = data.detail;
    const message = Array.isArray(detail)
      ? detail.map((item) => item.msg).join(", ")
      : detail || "Request failed. Check backend logs.";
    throw new Error(message);
  }

  return consumeSseStream(response, onLog);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideError();
  resetActivityLog();
  setLoading(true);
  appendActivityLog("Connecting to backend...");

  const projectId = projectInput.value.trim();

  try {
    const data = await checkPermissions(projectId, appendActivityLog);
    renderResults(data);
  } catch (error) {
    resultsSection.classList.add("hidden");
    appendActivityLog(`ERROR: ${error.message || "Something went wrong."}`);
    showError(error.message || "Something went wrong.");
  } finally {
    setLoading(false);
  }
});

loadServiceAccountInfo();
