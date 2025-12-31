import { getFirebase } from "../common/firebaseClient.js";
import router from "./router.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { subscribeNotifications } from "../common/notifications.js";

const { auth, db } = getFirebase();

const appView = document.getElementById("app-view");
const tabButtons = Array.from(document.querySelectorAll(".tab-btn[data-route]"));
const actionButton = document.querySelector('[data-action="create"]');
const notifTopButton = document.querySelector("[data-open-notifications]");
const notifTabButton = document.querySelector('.tab-btn[data-route="notifications"]');
const notifTopBadge = document.querySelector("[data-top-notif-badge]");
const notifTabBadge = document.querySelector("[data-tab-notif-badge]");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const viewLoaders = {
  feed: () => import("./views/feed.view.js"),
  groups: () => import("./views/groups.view.js"),
  messages: () => import("./views/messages.view.js"),
  notifications: () => import("./views/notifications.view.js")
};

const viewPanel = document.createElement("div");
viewPanel.className = "view-panel";
if (appView) {
  appView.appendChild(viewPanel);
}

let renderToken = 0;
let activeRoute = null;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const setActiveTab = (route) => {
  tabButtons.forEach((btn) => {
    const isActive = btn.dataset.route === route;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
  });
};

const setBadgeValue = (el, count) => {
  if (!el) return;
  if (count > 0) {
    el.hidden = false;
    el.textContent = count > 99 ? "99+" : String(count);
  } else {
    el.hidden = true;
    el.textContent = "0";
  }
};

const updateNotificationBadges = (count) => {
  setBadgeValue(notifTopBadge, count);
  setBadgeValue(notifTabBadge, count);
  notifTopButton?.classList.toggle("has-unread", count > 0);
  notifTabButton?.classList.toggle("has-unread", count > 0);
};

window.__brisaUpdateNotificationBadges = updateNotificationBadges;

const renderRoute = async (route) => {
  if (!viewPanel || !viewLoaders[route]) return;
  if (route === activeRoute) return;
  activeRoute = route;

  const token = ++renderToken;
  if (!prefersReducedMotion) {
    viewPanel.classList.add("view-panel--fade-out");
    await wait(160);
  }

  const module = await viewLoaders[route]();
  if (token !== renderToken) return;
  if (typeof module.default === "function") {
    module.default(viewPanel);
  } else {
    viewPanel.innerHTML = "";
  }

  if (!prefersReducedMotion) {
    viewPanel.classList.remove("view-panel--fade-out");
    viewPanel.classList.add("view-panel--fade-in");
    requestAnimationFrame(() => {
      viewPanel.classList.remove("view-panel--fade-in");
    });
  }
};

const handleRouteChange = (route) => {
  setActiveTab(route);
  renderRoute(route);
};

const bindTabHandlers = () => {
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const route = btn.dataset.route;
      if (route) router.navigate(route);
    });
  });

  actionButton?.addEventListener("click", () => {
    router.navigate("feed");
  });

  notifTopButton?.addEventListener("click", () => {
    router.navigate("notifications");
  });
};

router.onChange(handleRouteChange);
router.start();
bindTabHandlers();

let notifUnsub = null;
if (auth) {
  onAuthStateChanged(auth, (user) => {
    if (notifUnsub) {
      notifUnsub();
      notifUnsub = null;
    }
    if (!user || !db) {
      updateNotificationBadges(0);
      return;
    }
    notifUnsub = subscribeNotifications({
      db,
      uid: user.uid,
      max: 60,
      onChange: (items) => {
        const unread = items.filter((n) => !n.read).length;
        updateNotificationBadges(unread);
      }
    });
  });
} else {
  updateNotificationBadges(0);
}
