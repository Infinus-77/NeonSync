// ideas.js — NeonSync Idea Library (beta)
// Superadmin-only CRUD for ideas with starring, search, and category filtering.

import { auth, db } from "./firebase-config.js";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { requireAuth } from "./auth-guard.js";
import { renderSidebar } from "./sidebar.js";
import { showToast, showConfirm, sanitizeHtml, timeAgo, avatarHTML } from "./utils.js";

// ─── State ────────────────────────────────────────────────────────────────────
let currentUser = null;
let allIdeas = [];
let unsubIdeas = null;
let starFilterActive = false;
let allUsers = {};

// ─── Boot ─────────────────────────────────────────────────────────────────────
requireAuth(boot, ["super_admin"]);

async function boot(user) {
  currentUser = user;
  renderSidebar("ideas", user);
  bindUI();

  try {
    const usersSnap = await getDocs(query(collection(db, "users"), where("companyId", "==", user.companyId)));
    usersSnap.docs.forEach((d) => {
      allUsers[d.id] = { id: d.id, ...d.data() };
    });
  } catch (err) {
    console.error("Failed to load users for ideas page:", err);
  }

  listenIdeas();
}

// ─── Firestore Realtime Listener ──────────────────────────────────────────────
function listenIdeas() {
  const q = query(collection(db, "ideas"), where("companyId", "==", currentUser.companyId));
  unsubIdeas = onSnapshot(q, (snap) => {
    allIdeas = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    renderIdeas();
    updateSubtitle();
  }, (err) => {
    console.error("Ideas listener error:", err);
    showToast("Failed to load ideas", "error");
  });
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderIdeas() {
  const grid = document.getElementById("ideas-grid");
  if (!grid) return;

  const searchVal = (document.getElementById("idea-search")?.value || "").toLowerCase();
  const categoryVal = document.getElementById("category-filter")?.value || "";

  let filtered = allIdeas.filter((idea) => {
    const matchSearch =
      !searchVal ||
      (idea.title || "").toLowerCase().includes(searchVal) ||
      (idea.description || "").toLowerCase().includes(searchVal);
    const matchCategory = !categoryVal || idea.category === categoryVal;
    const matchStar = !starFilterActive || idea.isStarred;
    return matchSearch && matchCategory && matchStar;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="ideas-empty-state">
        <i class="ph ph-lightbulb" style="font-size:48px;color:var(--amber);opacity:0.5;"></i>
        <p style="margin-top:12px;color:var(--text-muted);font-size:14px;">
          ${allIdeas.length === 0 ? "No ideas yet — spark one!" : "No ideas match your filters."}
        </p>
      </div>`;
    return;
  }

  grid.innerHTML = filtered.map((idea) => buildCard(idea)).join("");
  bindCardEvents();
}

function buildCard(idea) {
  const starClass = idea.isStarred ? "starred" : "";
  const starIcon = idea.isStarred ? "ph-fill ph-star" : "ph ph-star";
  const categoryColor = getCategoryColor(idea.category);
  const u = allUsers[idea.createdBy];
  const avatarEl = `<div style="width:18px;height:18px;border-radius:50%;background:var(--gradient-brand);display:flex;align-items:center;justify-content:center;font-size:7px;font-weight:700;color:#000;overflow:hidden;flex-shrink:0;">${avatarHTML(u, 18)}</div>`;

  return `
    <div class="idea-card ${starClass}" data-id="${idea.id}">
      <div class="idea-card-header">
        <span class="idea-category-pill" style="--pill-color:${categoryColor};">
          ${sanitizeHtml(idea.category || "Other")}
        </span>
        <button class="idea-star-btn ${starClass}" data-id="${idea.id}" title="${idea.isStarred ? "Unstar" : "Star"} this idea">
          <i class="${starIcon}"></i>
        </button>
      </div>

      <h3 class="idea-card-title">${sanitizeHtml(idea.title)}</h3>

      ${idea.description
        ? `<p class="idea-card-desc">${sanitizeHtml(idea.description)}</p>`
        : ""}

      ${idea.links && idea.links.length > 0 ? `
        <div class="idea-card-links">
          ${idea.links.map((lnk) => `
            <a href="${sanitizeHtml(lnk.url)}" target="_blank" rel="noopener noreferrer" class="idea-link-chip" title="${sanitizeHtml(lnk.url)}">
              <i class="ph ph-arrow-square-out"></i>
              ${sanitizeHtml(lnk.label || _extractDomain(lnk.url))}
            </a>
          `).join("")}
        </div>` : ""}

      <div class="idea-card-footer">
        <span class="idea-card-meta">
          ${avatarEl}
          ${sanitizeHtml(idea.creatorName || "Unknown")}
        </span>
        <span class="idea-card-meta">
          <i class="ph ph-clock" style="font-size:12px;"></i>
          ${timeAgo(idea.createdAt)}
        </span>
      </div>

      <div class="idea-card-actions">
        <button class="idea-action-btn edit" data-id="${idea.id}" title="Edit idea">
          <i class="ph ph-pencil-simple"></i>
        </button>
        <button class="idea-action-btn delete" data-id="${idea.id}" title="Delete idea">
          <i class="ph ph-trash"></i>
        </button>
      </div>
    </div>`;
}

function getCategoryColor(cat) {
  const map = {
    Feature:     "var(--blue)",
    "UI/UX":     "var(--purple)",
    Marketing:   "var(--amber)",
    Integration: "var(--green)",
    "Bug Fix":   "var(--rose)",
    Other:       "var(--text-muted)",
  };
  return map[cat] || "var(--text-muted)";
}

function updateSubtitle() {
  const el = document.getElementById("ideas-subtitle");
  if (!el) return;
  const starCount = allIdeas.filter((i) => i.isStarred).length;
  el.textContent = `${allIdeas.length} idea${allIdeas.length !== 1 ? "s" : ""} total · ${starCount} starred`;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

async function addIdea(data) {
  try {
    await addDoc(collection(db, "ideas"), {
      title: data.title.trim(),
      description: (data.description || "").trim(),
      category: data.category,
      links: data.links || [],
      isStarred: false,
      companyId: currentUser.companyId,
      createdBy: currentUser.id,
      creatorName: currentUser.displayName || currentUser.name || "Unknown",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    showToast("Idea added!", "success");
  } catch (err) {
    console.error("Add idea error:", err);
    showToast("Failed to add idea", "error");
  }
}

async function updateIdea(id, data) {
  try {
    await updateDoc(doc(db, "ideas", id), {
      title: data.title.trim(),
      description: (data.description || "").trim(),
      category: data.category,
      links: data.links || [],
      updatedAt: serverTimestamp(),
    });
    showToast("Idea updated!", "success");
  } catch (err) {
    console.error("Update idea error:", err);
    showToast("Failed to update idea", "error");
  }
}

async function deleteIdea(id) {
  const ok = await showConfirm("Are you sure you want to delete this idea? This cannot be undone.");
  if (!ok) return;
  try {
    await deleteDoc(doc(db, "ideas", id));
    showToast("Idea deleted", "success");
  } catch (err) {
    console.error("Delete idea error:", err);
    showToast("Failed to delete idea", "error");
  }
}

async function toggleStar(id) {
  const idea = allIdeas.find((i) => i.id === id);
  if (!idea) return;
  try {
    await updateDoc(doc(db, "ideas", id), {
      isStarred: !idea.isStarred,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.error("Toggle star error:", err);
    showToast("Failed to update star", "error");
  }
}

// ─── Modal helpers ────────────────────────────────────────────────────────────

function openModal(editIdea = null) {
  const overlay = document.getElementById("idea-modal");
  const titleEl = document.getElementById("idea-modal-title");
  const submitLabel = document.getElementById("idea-submit-label");
  const form = document.getElementById("idea-form");
  const editIdField = document.getElementById("edit-idea-id");

  if (!overlay || !form) return;

  form.reset();
  editIdField.value = "";
  clearLinkRows();

  if (editIdea) {
    titleEl.innerHTML = `<i class="ph ph-pencil-simple" style="color:var(--blue);margin-right:6px;"></i> Edit Idea`;
    submitLabel.textContent = "Save Changes";
    editIdField.value = editIdea.id;
    document.getElementById("idea-title").value = editIdea.title || "";
    document.getElementById("idea-description").value = editIdea.description || "";
    document.getElementById("idea-category").value = editIdea.category || "";
    // Populate existing links
    if (editIdea.links && editIdea.links.length > 0) {
      editIdea.links.forEach((lnk) => addLinkRow(lnk.label, lnk.url));
    }
  } else {
    titleEl.innerHTML = `<i class="ph ph-lightbulb" style="color:var(--amber);margin-right:6px;"></i> New Idea`;
    submitLabel.textContent = "Add Idea";
  }

  overlay.classList.add("active");
}

function closeModal() {
  document.getElementById("idea-modal")?.classList.remove("active");
}

// ─── UI Bindings ──────────────────────────────────────────────────────────────

function bindUI() {
  // New idea button
  document.getElementById("add-idea-btn")?.addEventListener("click", () => openModal());

  // Modal close
  document.getElementById("idea-modal-close-btn")?.addEventListener("click", closeModal);
  document.getElementById("idea-cancel-btn")?.addEventListener("click", closeModal);

  // Click overlay to close
  document.getElementById("idea-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "idea-modal") closeModal();
  });

  // Form submit
  document.getElementById("idea-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("idea-title").value;
    const description = document.getElementById("idea-description").value;
    const category = document.getElementById("idea-category").value;
    const editId = document.getElementById("edit-idea-id").value;
    const links = collectLinks();

    if (!title || !category) {
      showToast("Title and category are required", "warning");
      return;
    }

    if (editId) {
      await updateIdea(editId, { title, description, category, links });
    } else {
      await addIdea({ title, description, category, links });
    }
    closeModal();
  });

  // Add link button
  document.getElementById("idea-add-link-btn")?.addEventListener("click", () => addLinkRow());

  // Search
  document.getElementById("idea-search")?.addEventListener("input", () => renderIdeas());

  // Category filter
  document.getElementById("category-filter")?.addEventListener("change", () => renderIdeas());

  // Star filter toggle
  document.getElementById("star-filter-btn")?.addEventListener("click", () => {
    starFilterActive = !starFilterActive;
    const btn = document.getElementById("star-filter-btn");
    btn?.classList.toggle("active", starFilterActive);
    renderIdeas();
  });

  // Escape closes modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
}

function bindCardEvents() {
  // Star buttons
  document.querySelectorAll(".idea-star-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleStar(btn.dataset.id);
    });
  });

  // Edit buttons
  document.querySelectorAll(".idea-action-btn.edit").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idea = allIdeas.find((i) => i.id === btn.dataset.id);
      if (idea) openModal(idea);
    });
  });

  // Delete buttons
  document.querySelectorAll(".idea-action-btn.delete").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteIdea(btn.dataset.id);
    });
  });
}

// ─── Link Row Helpers ─────────────────────────────────────────────────────────

function addLinkRow(label = "", url = "") {
  const list = document.getElementById("idea-links-list");
  if (!list) return;
  const row = document.createElement("div");
  row.className = "idea-link-row";
  row.innerHTML = `
    <input type="text" class="form-input idea-link-label" placeholder="Label (optional)" value="${sanitizeHtml(label)}" />
    <input type="url" class="form-input idea-link-url" placeholder="https://..." value="${sanitizeHtml(url)}" />
    <button type="button" class="idea-link-remove" title="Remove link">
      <i class="ph ph-x"></i>
    </button>
  `;
  row.querySelector(".idea-link-remove").addEventListener("click", () => row.remove());
  list.appendChild(row);
}

function clearLinkRows() {
  const list = document.getElementById("idea-links-list");
  if (list) list.innerHTML = "";
}

function collectLinks() {
  const rows = document.querySelectorAll(".idea-link-row");
  const links = [];
  rows.forEach((row) => {
    const url = row.querySelector(".idea-link-url")?.value?.trim();
    const label = row.querySelector(".idea-link-label")?.value?.trim();
    if (url) {
      links.push({ label: label || "", url });
    }
  });
  return links;
}

function _extractDomain(url) {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return url;
  }
}
