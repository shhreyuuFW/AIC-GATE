
"use strict";

const API_BASE = "";
const $ = (selector) => document.querySelector(selector);

const state = {
  sessions: [],
  selectedSessionId: null,
  busy: false,
};

const PAGE_INFO = {
  overview: {
    title: "Overview",
    description: "Manage temporary access to approved AWS resources.",
  },
  requests: {
    title: "Access Requests",
    description: "Create and manage requests for temporary S3 access.",
  },
  sessions: {
    title: "Sessions",
    description: "Inspect session status, expiry, and available actions.",
  },
  "object-reader": {
    title: "S3 Object Reader",
    description: "Read an object through an existing access session.",
  },
};

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function showNotice(message, type = "info") {
  const notice = $("#notice");
  notice.textContent = message;
  notice.className = `notice ${type}`;
}

function clearNotice() {
  $("#notice").className = "notice hidden";
  $("#notice").textContent = "";
}

function setBusy(button, busy, busyText = "Working…") {
  if (!button) return;

  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

async function apiRequest(path, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...options.headers,
  };

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const contentType = response.headers.get("content-type") || "";
  let payload;

  if (contentType.includes("application/json")) {
    payload = await response.json();
  } else {
    payload = await response.text();
  }

  if (!response.ok) {
    const detail =
      payload && typeof payload === "object"
        ? payload.detail || payload.message || JSON.stringify(payload)
        : payload || response.statusText;

    const error = new Error(
      `HTTP ${response.status}: ${String(detail)}`
    );
    error.status = response.status;
    throw error;
  }

  return payload;
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function effectiveStatus(session) {
  const storedStatus = String(session.status || "UNKNOWN").toUpperCase();

  if (storedStatus === "REVOKED" || storedStatus === "EXPIRED") {
    return storedStatus;
  }

  if (session.expires_at) {
    const expiry = new Date(session.expires_at).getTime();

    if (!Number.isNaN(expiry) && Date.now() >= expiry) {
      return "EXPIRED";
    }
  }

  return storedStatus;
}

function statusBadge(status) {
  const safeStatus = ["ACTIVE", "EXPIRED", "REVOKED"].includes(status)
    ? status
    : "UNKNOWN";

  return `<span class="badge ${safeStatus.toLowerCase()}">${safeStatus}</span>`;
}

function shortId(id) {
  return String(id || "").slice(0, 8) + (id ? "…" : "");
}

function renderSessionRow(session, detailed = false) {
  const id = escapeHTML(session.session_id);
  const selected = session.session_id === state.selectedSessionId;
  const status = effectiveStatus(session);

  if (!detailed) {
    return `
      <tr>
        <td class="session-id" title="${id}">${escapeHTML(shortId(id))}</td>
        <td>${escapeHTML(session.prefix)}</td>
        <td>${statusBadge(status)}</td>
        <td>${escapeHTML(formatDate(session.expires_at))}</td>
        <td>
          <button class="button secondary" type="button"
            data-select-session="${id}">Select</button>
        </td>
      </tr>`;
  }

  return `
    <tr ${selected ? 'style="background:#eef5ff"' : ""}>
      <td class="session-id" title="${id}">${escapeHTML(shortId(id))}</td>
      <td>${escapeHTML(session.bucket)}</td>
      <td>${escapeHTML(session.prefix)}</td>
      <td>${statusBadge(status)}</td>
      <td>${escapeHTML(formatDate(session.expires_at))}</td>
      <td>
        <div class="button-row">
          <button class="button secondary" type="button"
            data-select-session="${id}">Select</button>
          <button class="button danger" type="button"
            data-revoke-session="${id}"
            ${status !== "ACTIVE" ? "disabled" : ""}>Revoke</button>
        </div>
      </td>
    </tr>`;
}

function renderSessionTable(element, sessions, detailed = false) {
  if (!sessions.length) {
    element.innerHTML = `
      <tr><td colspan="${detailed ? 6 : 5}" class="empty-state">
        No sessions found. Create an access request to get started.
      </td></tr>`;
    return;
  }

  element.innerHTML = sessions
    .map((session) => renderSessionRow(session, detailed))
    .join("");
}

function renderSessions() {
  const sessions = [...state.sessions].sort((a, b) => {
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });

  renderSessionTable($("#recent-sessions"), sessions.slice(0, 5));
  renderSessionTable($("#all-sessions"), sessions, true);

  const statuses = sessions.map(effectiveStatus);

  $("#stat-total").textContent = String(sessions.length);
  $("#stat-active").textContent = String(
    statuses.filter((status) => status === "ACTIVE").length
  );
  $("#stat-expired").textContent = String(
    statuses.filter((status) => status === "EXPIRED").length
  );
  $("#stat-revoked").textContent = String(
    statuses.filter((status) => status === "REVOKED").length
  );

  const sessionSelect = $("#object-session");
  const previousSelection = sessionSelect.value;

  sessionSelect.innerHTML = `
    <option value="">Select a session</option>
    ${sessions.map((session) => `
      <option value="${escapeHTML(session.session_id)}">
        ${escapeHTML(shortId(session.session_id))} ·
        ${escapeHTML(session.prefix)} ·
        ${escapeHTML(effectiveStatus(session))}
      </option>
    `).join("")}
  `;

  if (sessions.some((session) => session.session_id === previousSelection)) {
    sessionSelect.value = previousSelection;
  } else if (
    state.selectedSessionId &&
    sessions.some((session) => session.session_id === state.selectedSessionId)
  ) {
    sessionSelect.value = state.selectedSessionId;
  }

  updateSelectedSessionDetails();
}

function updateSelectedSessionDetails() {
  const session = state.sessions.find(
    (item) => item.session_id === state.selectedSessionId
  );

  const details = $("#selected-session-details");
  const issueButton = $("#issue-credentials");
  const revokeButton = $("#revoke-session");

  if (!session) {
    details.textContent = "Select a session from the table to inspect it.";
    issueButton.disabled = true;
    revokeButton.disabled = true;
    return;
  }

  const status = effectiveStatus(session);

  details.textContent =
    `ID: ${session.session_id} | Bucket: ${session.bucket} | ` +
    `Prefix: ${session.prefix} | Status: ${status} | ` +
    `Expires: ${formatDate(session.expires_at)}`;

  issueButton.disabled = status !== "ACTIVE";
  revokeButton.disabled = status !== "ACTIVE";

  $("#object-session").value = session.session_id;
}

async function refreshSessions(options = {}) {
  const quiet = options.quiet === true;

  try {
    // This endpoint returns one session, so a known session ID is required.
    // The current API does not yet expose a list-all-sessions endpoint.
    const knownIds = [
      ...new Set(state.sessions.map((session) => session.session_id)),
    ];

    const results = await Promise.allSettled(
      knownIds.map((id) =>
        apiRequest(`/sessions/${encodeURIComponent(id)}`)
      )
    );

    const updated = [];
    const failures = [];

    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        updated.push(result.value);
      } else {
        // Keep previously known records visible if a refresh fails.
        const oldSession = state.sessions.find(
          (session) => session.session_id === knownIds[index]
        );

        if (oldSession) updated.push(oldSession);
        failures.push(result.reason);
      }
    });

    state.sessions = updated;
    renderSessions();

    if (failures.length && !quiet) {
      showNotice(
        `Refreshed with ${failures.length} error(s). Some sessions may be stale.`,
        "info"
      );
    }

    if (!quiet && !failures.length) {
      showNotice("Session details refreshed.", "success");
    }
  } catch (error) {
    if (!quiet) showNotice(error.message, "error");
  }
}

async function checkAPI() {
  const indicator = $("#api-indicator");
  const label = $("#api-status");

  try {
    await apiRequest("/health");
    indicator.className = "status-dot online";
    label.textContent = "API connected";
  } catch {
    indicator.className = "status-dot offline";
    label.textContent = "API unavailable";
  }
}

function selectSession(id) {
  const session = state.sessions.find((item) => item.session_id === id);

  if (!session) {
    showNotice("Session is not loaded. Refresh and try again.", "error");
    return;
  }

  state.selectedSessionId = id;
  $("#object-session").value = id;
  $("#credential-result").classList.add("hidden");
  renderSessions();

  showNotice(`Selected session ${shortId(id)}.`, "info");
}

async function loadSessionById(id) {
  const session = await apiRequest(
    `/sessions/${encodeURIComponent(id)}`
  );

  const index = state.sessions.findIndex(
    (item) => item.session_id === session.session_id
  );

  if (index >= 0) {
    state.sessions[index] = session;
  } else {
    state.sessions.unshift(session);
  }

  state.selectedSessionId = session.session_id;
  renderSessions();

  return session;
}

async function createRequest(withCredentials = false, button = null) {
  clearNotice();

  const actions = Array.from(
    document.querySelectorAll('input[name="actions"]:checked')
  ).map((input) => input.value);

  if (!actions.length) {
    showNotice("Select at least one requested action.", "error");
    return;
  }

  const payload = {
    bucket: $("#bucket").value.trim(),
    prefix: $("#prefix").value.trim(),
    actions,
    duration_minutes: Number($("#duration").value),
    reason: $("#reason").value.trim(),
  };

  setBusy(button, true, "Creating…");

  try {
    let session;

    if (withCredentials) {
      const result = await apiRequest("/requests", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      session = result.session || result;
      const id = session.session_id;

      if (!id) {
        throw new Error(
          "The response did not contain a session ID. Inspect the API response."
        );
      }

      await loadSessionById(id);

      // Request credentials separately so the UI can explain credential errors.
      try {
        const credentials = await apiRequest(
          `/sessions/${encodeURIComponent(id)}/credentials`,
          { method: "POST" }
        );

        displayCredentialResult(credentials);
        showNotice(
          "Session created and credentials issued. Keep credentials secret.",
          "success"
        );
      } catch (error) {
        showNotice(
          `Session created, but credential issuance failed: ${error.message}`,
          "error"
        );
      }
    } else {
      session = await apiRequest("/requests", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      const id = session.session_id;

      if (!id) {
        throw new Error(
          "The response did not contain a session ID. Inspect the API response."
        );
      }

      await loadSessionById(id);
      showNotice(`Access session created: ${id}`, "success");
    }

    showView("sessions");
    $("#reason").value = "";
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

function displayCredentialResult(result) {
  const box = $("#credential-result");
  box.classList.remove("hidden");

  // Never render credentials into HTML. This panel shows only safe metadata.
  const expiry = result.expires_at
    ? `Expires: ${formatDate(result.expires_at)}`
    : "Credential issuance succeeded.";

  box.textContent =
    `${expiry} Temporary credentials were returned by the API. ` +
    "Their secret values are not displayed by this dashboard.";
}

async function issueCredentials() {
  const id = state.selectedSessionId;

  if (!id) {
    showNotice("Select a session first.", "error");
    return;
  }

  const button = $("#issue-credentials");
  setBusy(button, true, "Issuing…");

  try {
    const result = await apiRequest(
      `/sessions/${encodeURIComponent(id)}/credentials`,
      { method: "POST" }
    );

    displayCredentialResult(result);
    showNotice("Credential issuance succeeded.", "success");
    await loadSessionById(id);
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

async function revokeSession(id = state.selectedSessionId) {
  if (!id) {
    showNotice("Select a session first.", "error");
    return;
  }

  const session = state.sessions.find((item) => item.session_id === id);

  if (session && effectiveStatus(session) !== "ACTIVE") {
    showNotice("Only active sessions can be revoked.", "error");
    return;
  }

  if (!window.confirm(
    "Revoke this session? Previously issued STS credentials may remain usable until they expire."
  )) {
    return;
  }

  try {
    await apiRequest(
      `/sessions/${encodeURIComponent(id)}/revoke`,
      { method: "POST" }
    );

    await loadSessionById(id);
    showNotice(
      "Session marked as revoked. Previously issued STS credentials are not automatically invalidated.",
      "success"
    );
  } catch (error) {
    showNotice(error.message, "error");
  }
}

async function readObject(event) {
  event.preventDefault();
  clearNotice();

  const id = $("#object-session").value;
  const key = $("#object-key").value.trim();
  const button = event.submitter || event.currentTarget.querySelector(
    'button[type="submit"]'
  );

  if (!id || !key) {
    showNotice("Select a session and enter a full object key.", "error");
    return;
  }

  setBusy(button, true, "Reading…");

  try {
    const result = await apiRequest(
      `/sessions/${encodeURIComponent(id)}/objects?key=${encodeURIComponent(key)}`
    );

    $("#object-result").classList.remove("hidden");

    const content = typeof result === "string"
      ? result
      : result.content ?? result.body ?? JSON.stringify(result, null, 2);

    $("#object-content").textContent = String(content);

    showNotice("Object read succeeded.", "success");
  } catch (error) {
    $("#object-result").classList.remove("hidden");
    $("#object-content").textContent = error.message;
    showNotice(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

function showView(viewName) {
  if (!PAGE_INFO[viewName]) viewName = "overview";

  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("hidden", view.id !== `view-${viewName}`);
  });

  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.toggle("active", link.dataset.view === viewName);
  });

  $("#page-title").textContent = PAGE_INFO[viewName].title;
  $("#page-description").textContent = PAGE_INFO[viewName].description;

  if (viewName === "sessions") {
    refreshSessions({ quiet: true });
  }

  window.location.hash = viewName;
}

document.addEventListener("click", async (event) => {
  const nav = event.target.closest("[data-view]");
  if (nav) {
    event.preventDefault();
    showView(nav.dataset.view);
    return;
  }

  const go = event.target.closest("[data-go]");
  if (go) {
    event.preventDefault();
    showView(go.dataset.go);
    return;
  }

  const select = event.target.closest("[data-select-session]");
  if (select) {
    selectSession(select.dataset.selectSession);
    return;
  }

  const revoke = event.target.closest("[data-revoke-session]");
  if (revoke) {
    await revokeSession(revoke.dataset.revokeSession);
  }
});

$("#request-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await createRequest(false, event.submitter);
});

$("#create-with-credentials").addEventListener("click", async (event) => {
  await createRequest(true, event.currentTarget);
});

$("#refresh-button").addEventListener("click", async () => {
  await checkAPI();
  await refreshSessions();
});

$("#issue-credentials").addEventListener("click", issueCredentials);

$("#revoke-session").addEventListener("click", async () => {
  await revokeSession();
});

$("#object-form").addEventListener("submit", readObject);

$("#object-session").addEventListener("change", (event) => {
  state.selectedSessionId = event.target.value || null;
  updateSelectedSessionDetails();
});

$("#copy-object").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("#object-content").textContent);
    showNotice("Result copied.", "success");
  } catch {
    showNotice("Clipboard access was blocked by the browser.", "error");
  }
});

window.addEventListener("hashchange", () => {
  showView(window.location.hash.slice(1));
});

async function initialize() {
  showView(window.location.hash.slice(1) || "overview");
  await checkAPI();
}

initialize();
