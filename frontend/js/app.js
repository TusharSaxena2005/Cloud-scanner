import { fetchServiceAccount } from "./api.js";
import { renderFlow } from "./pages/flow.js";
import { renderScanner } from "./pages/scanner.js";
import { renderUnprotected } from "./pages/unprotected.js";
import { getState, patchState, subscribe } from "./store.js";
import { bindDrawerClose, closeDrawer } from "./utils.js";

const routes = {
  scanner: renderScanner,
  unprotected: renderUnprotected,
  flow: renderFlow,
};

function currentRoute() {
  const hash = window.location.hash.replace("#/", "") || "scanner";
  return routes[hash] ? hash : "scanner";
}

function updateHeader(state) {
  const scopeLabel =
    state.scopeId && state.scopeType
      ? `${state.scopeType} / ${state.scopeId}`
      : "Not configured";
  document.getElementById("header-scope").textContent = scopeLabel;

  const scanStatus = document.getElementById("header-scan-status");
  const status = state.scanStatus || "idle";
  scanStatus.textContent = status.toUpperCase();
  scanStatus.className = `status-pill ${status.replaceAll("_", "-")}`;

  document.querySelectorAll(".main-nav a").forEach((link) => {
    link.classList.toggle("active", link.dataset.route === currentRoute());
  });
}

function render() {
  closeDrawer();
  const route = currentRoute();
  const root = document.getElementById("page-root");
  routes[route](root);
  updateHeader(getState());
}

async function bootstrap() {
  bindDrawerClose();
  window.addEventListener("hashchange", render);
  subscribe(() => updateHeader(getState()));
  render();

  try {
    const serviceAccount = await fetchServiceAccount();
    patchState({ serviceAccount });
  } catch {
    patchState({ serviceAccount: { email: "Unavailable", auth_method: "adc" } });
  }

  render();
}

bootstrap();
