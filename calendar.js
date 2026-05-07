import { db } from "./firebase-config.js";
import { requireAuth } from "./auth-guard.js";
import { renderSidebar } from "./sidebar.js";
import { initNotifications } from "./notifications.js";
import { checkDeadlineAlerts } from "./deadline-alert.js";
import {
  collection,
  query,
  where,
  or,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { showToast, sanitizeHtml, showConfirm, timeAgo } from "./utils.js";

let currentUser;
let calendar;
let allTasks = [];
let allEvents = [];
let unsubscribeTasks, unsubscribeEvents;
let currentEventContext = null; // store the clicked event data

requireAuth((user) => {
  const loadingOverlay = document.getElementById("loading-overlay");
  if (loadingOverlay) {
    loadingOverlay.style.opacity = "0";
    loadingOverlay.style.transition = "opacity 0.3s ease";
    setTimeout(() => loadingOverlay.remove(), 320);
  }

  currentUser = user;
  renderSidebar("calendar", user);
  initNotifications(user.id);
  checkDeadlineAlerts(user);

  initCalendar();
  loadTasks();
  loadCustomEvents();
});

function initCalendar() {
  const calendarEl = document.getElementById("calendar-view");
  
  calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: "dayGridMonth",
    expandRows: true,
    headerToolbar: {
      left: "prev,next today",
      center: "title",
      right: "dayGridMonth,timeGridWeek,timeGridDay",
    },
    eventTimeFormat: {
      hour: "numeric",
      minute: "2-digit",
      meridiem: "short"
    },
    height: "auto",
    navLinks: false,
    selectable: true,
    unselectAuto: true,
    selectLongPressDelay: 250, // Faster selection on touch devices
    longPressDelay: 250, // Faster event clicking on touch devices
    dateClick: function(info) {
      // Fires immediately on tap (mobile-friendly)
      openDayDetail(info.dateStr, info.dateStr);
    },
    select: function (info) {
      // Clicked on a date/time range
      openDayDetail(info.startStr, info.endStr);
      calendar.unselect();
    },
    eventClick: function (info) {
      // Clicked on an event
      openEventDetail(info.event);
    },
    events: [],
  });
  calendar.render();
  
  // Ensure calendar resizes smoothly during CSS transitions or inspector toggle
  const container = document.querySelector(".calendar-main-area");
  if (container) {
    const ro = new ResizeObserver(() => {
      if (calendar) calendar.updateSize();
    });
    ro.observe(container);
  }
  
  // Initialize Flatpickr for the event form
  if (typeof flatpickr !== "undefined") {
    flatpickr("#ev-start", {
      enableTime: true,
      dateFormat: "Y-m-d\\TH:i",
      altInput: true,
      altFormat: "d/m/Y h:i K"
    });
    flatpickr("#ev-end", {
      enableTime: true,
      dateFormat: "Y-m-d\\TH:i",
      altInput: true,
      altFormat: "d/m/Y h:i K"
    });
  }
}

function loadTasks() {
  let q;
  if (currentUser.role === "member") {
    // Only fetch tasks assigned to them or common tasks
    // Since we need an OR query which firestore doesn't natively support easily with onSnapshot without composite indexes,
    // we'll listen to both and merge.
    
    let assignedTasks = [];
    let commonTasks = [];

    const mergeAndRender = () => {
      const seen = new Set();
      allTasks = [...assignedTasks, ...commonTasks].filter((t) => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      });
      refreshCalendarEvents();
    };

    onSnapshot(
      query(collection(db, "tasks"), where("assignedTo", "array-contains", currentUser.id)),
      (snap) => {
        assignedTasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        mergeAndRender();
      }
    );

    onSnapshot(
      query(collection(db, "tasks"), where("isCommonTask", "==", true)),
      (snap) => {
        commonTasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        mergeAndRender();
      }
    );

  } else {
    // Admin/SuperAdmin
    q = collection(db, "tasks");
    onSnapshot(q, (snap) => {
      allTasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      refreshCalendarEvents();
    });
  }
}

function loadCustomEvents() {
  const isAdmin = currentUser.role === "admin" || currentUser.role === "super_admin";
  
  // We MUST use a query that matches our security rules. 
  // In Firestore, you can only listen to a collection if your rules allow reading 
  // every document in the result set. By using a query with 'or', we filter 
  // the request to only include documents we are allowed to see.
  const conditions = [
    where("createdBy", "==", currentUser.id),
    where("visibility", "==", "all")
  ];
  
  if (isAdmin) {
    conditions.push(where("visibility", "==", "admin"));
  }

  const q = query(collection(db, "events"), or(...conditions));

  onSnapshot(q, (snap) => {
    allEvents = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    refreshCalendarEvents();
  }, (err) => {
    console.error("Custom events snapshot error:", err);
  });
}

function refreshCalendarEvents() {
  if (!calendar) return;

  const calendarEvents = [];
  const now = new Date();

  // 1. Map Tasks
  allTasks.forEach((t) => {
    if (!t.deadline) return; // tasks without deadlines aren't shown
    
    const d = t.deadline.toDate ? t.deadline.toDate() : new Date(t.deadline);
    const isOverdue = t.status !== "completed" && d < now;
    
    calendarEvents.push({
      id: "task_" + t.id,
      title: t.title,
      start: d,
      allDay: false,
      classNames: [isOverdue ? "fc-event-overdue" : "fc-event-task"],
      extendedProps: {
        type: "task",
        originalId: t.id,
        description: t.description,
        status: t.status,
        attachments: t.attachments || []
      }
    });
  });

  // 2. Map Custom Events
  allEvents.forEach((e) => {
    const start = e.start?.toDate ? e.start.toDate() : new Date(e.start);
    const end = e.end?.toDate ? e.end.toDate() : new Date(e.end);

    calendarEvents.push({
      id: "event_" + e.id,
      title: e.title,
      start: start,
      end: end,
      allDay: false,
      classNames: ["fc-event-custom"],
      extendedProps: {
        type: "custom",
        originalId: e.id,
        description: e.description,
        visibility: e.visibility || "private",
        createdBy: e.createdBy
      }
    });
  });

  calendar.removeAllEvents();
  calendar.addEventSource(calendarEvents);
}

// ─── Side Panel & Modal interactions ─────────────────────────────────────────

let currentDaySelectionStart = "";
let currentDaySelectionEnd = "";

window.openSidePanel = () => {
  console.log("Opening side panel");
  const panel = document.getElementById("calendar-side-panel");
  const overlay = document.getElementById("calendar-side-panel-overlay");
  if (panel) panel.classList.add("active");
  if (overlay) overlay.classList.add("active");
  
  if (typeof calendar !== "undefined" && calendar && typeof calendar.updateSize === "function") {
    setTimeout(() => calendar.updateSize(), 310);
  }
};

window.closeSidePanel = () => {
  console.log("Closing side panel");
  const panel = document.getElementById("calendar-side-panel");
  const overlay = document.getElementById("calendar-side-panel-overlay");
  if (panel) panel.classList.remove("active");
  if (overlay) overlay.classList.remove("active");
  
  if (typeof calendar !== "undefined" && calendar && typeof calendar.updateSize === "function") {
    setTimeout(() => calendar.updateSize(), 310);
  }
};

// Ensure the close button works even if onclick attribute fails
document.addEventListener("click", (e) => {
  if (e.target.closest(".side-panel-close")) {
    window.closeSidePanel();
  }
});

window.openDayDetail = (startStr = "", endStr = "") => {
  currentDaySelectionStart = startStr;
  currentDaySelectionEnd = endStr;
  
  const dateObj = new Date(startStr);
  const formattedDate = dateObj.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  document.getElementById("sp-title").textContent = formattedDate;

  const selectedDatePrefix = startStr.split("T")[0];
  const dayEvents = calendar.getEvents().filter(e => {
    const eStartPrefix = e.startStr.split("T")[0];
    return eStartPrefix === selectedDatePrefix;
  });

  const contentEl = document.getElementById("sp-content");
  let listHtml = "";

  if (dayEvents.length === 0) {
    listHtml = `<div style="text-align: center; color: var(--text-muted); font-size: 13px; padding: 20px 0;">No events scheduled for this day.</div>`;
  } else {
    dayEvents.sort((a, b) => a.start - b.start);
    listHtml = `<div style="display: flex; flex-direction: column; gap: 8px;">`;
    dayEvents.forEach(e => {
      const isTask = e.extendedProps.type === "task";
      const isOverdue = e.classNames.includes("fc-event-overdue");
      let dotColor = isTask ? "var(--green)" : "var(--purple)";
      if (isOverdue) dotColor = "var(--danger)";
      const timeStr = e.start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

      listHtml += `
        <div style="display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-glass); border-radius: 8px; cursor: pointer; transition: all 0.2s ease;"
             onmouseover="this.style.background='rgba(255,255,255,0.06)'"
             onmouseout="this.style.background='rgba(255,255,255,0.03)'"
             onclick="openEventDetailFromId('${e.id}')">
          <div style="width: 8px; height: 8px; border-radius: 50%; background: ${dotColor}; flex-shrink: 0;"></div>
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 13px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${sanitizeHtml(e.title)}</div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">${timeStr}</div>
          </div>
          <i class="ph ph-caret-right" style="color: var(--text-muted);"></i>
        </div>
      `;
    });
    listHtml += `</div>`;
  }

  contentEl.innerHTML = `
    <div style="flex: 1;">${listHtml}</div>
    <div style="display: flex; justify-content: flex-end; gap: 10px; padding-top: 16px; border-top: 1px solid var(--border-glass); margin-top: 20px;">
      <button type="button" class="btn btn-primary" onclick="openNewEventFromDay()">
        <i class="ph ph-plus"></i> Create Event
      </button>
    </div>
  `;

  openSidePanel();
};

window.openEventDetailFromId = (eventId) => {
  const eventObj = calendar.getEventById(eventId);
  if (eventObj) {
    openEventDetail(eventObj);
  }
};

window.openNewEventFromDay = () => {
  closeSidePanel();
  openNewEventModal(currentDaySelectionStart, currentDaySelectionEnd);
};

window.openNewEventModal = (startStr = "", endStr = "") => {
  document.getElementById("event-form").reset();
  document.getElementById("ev-id").value = "";
  document.querySelector("#event-modal .modal-title").textContent = "Create New Event";
  document.getElementById("event-form-submit").textContent = "Create Event";
  
  if (startStr) {
    const startFp = document.getElementById("ev-start")._flatpickr;
    if (startFp) startFp.setDate(startStr);
    else document.getElementById("ev-start").value = startStr.slice(0, 16);
  }
  if (endStr) {
    const endFp = document.getElementById("ev-end")._flatpickr;
    if (endFp) endFp.setDate(endStr);
    else document.getElementById("ev-end").value = endStr.slice(0, 16);
  }

  openModal("event-modal");
};

window.submitEvent = async (e) => {
  e.preventDefault();
  
  const title = document.getElementById("ev-title").value.trim();
  const desc = document.getElementById("ev-desc").value.trim();
  const startVal = document.getElementById("ev-start").value;
  const endVal = document.getElementById("ev-end").value;

  if (!title || !startVal || !endVal) {
    showToast("Please fill all required fields", "error");
    return;
  }

  const btn = document.getElementById("event-form-submit");
  const visibility = document.getElementById("ev-visibility").value || "private";

  const id = document.getElementById("ev-id").value;

  btn.disabled = true;

  try {
    const eventData = {
      title,
      description: desc,
      start: Timestamp.fromDate(new Date(startVal)),
      end: Timestamp.fromDate(new Date(endVal)),
      visibility,
      updatedAt: serverTimestamp()
    };

    if (id) {
      await updateDoc(doc(db, "events", id), eventData);
      showToast("Event updated!", "success");
    } else {
      await addDoc(collection(db, "events"), {
        ...eventData,
        createdBy: currentUser.id,
        createdAt: serverTimestamp()
      });
      showToast("Event created!", "success");
    }
    
    closeModal("event-modal");
  } catch (err) {
    console.error(err);
    showToast("Failed to save event: " + (err.code || err.message), "error");
  }

  btn.disabled = false;
};

window.openEventDetail = (event) => {
  currentEventContext = event;
  const props = event.extendedProps;
  
  document.getElementById("sp-title").textContent = "Event Detail";
  
  const startStr = event.start.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  let timeStr = startStr;
  if (event.end) {
    const endStr = event.end.toLocaleString("en-US", { hour: "2-digit", minute: "2-digit" });
    timeStr += ` - ${endStr}`;
  }
  
  let docsHtml = "";
  let actionsHtml = "";

  if (props.type === "task") {
    actionsHtml += `<button type="button" class="btn btn-secondary" onclick="goToTask()">View Full Task</button>`;
    
    if (props.attachments && props.attachments.length > 0) {
      const links = props.attachments.map(a => `
        <a href="${sanitizeHtml(a.fileURL)}" target="_blank" class="attachment-chip">
          <i class="ph ph-file-text"></i>
          <span>${sanitizeHtml(a.fileName)}</span>
        </a>
      `).join("");
      docsHtml = `
        <div style="margin-top: 20px;">
          <span style="display: block; font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Uploaded Docs</span>
          <div style="display: flex; flex-direction: column; gap: 8px;">${links}</div>
        </div>
      `;
    }
  } else if (props.type === "custom") {
    const isAdmin = currentUser.role === "admin" || currentUser.role === "super_admin";
    const isCreator = props.createdBy === currentUser.id;
    
    if (isCreator || isAdmin) {
      actionsHtml += `
        <button type="button" class="btn btn-secondary" onclick="openEditEvent()">
          <i class="ph ph-pencil"></i> Edit
        </button>
        <button type="button" class="btn btn-danger" onclick="deleteEvent()">
          <i class="ph ph-trash"></i> Delete
        </button>
      `;
    }
  }

  actionsHtml += `<button type="button" class="btn btn-secondary" onclick="closeSidePanel()">Close</button>`;

  const visibilityLabels = {
    private: { label: "Private", icon: "ph-lock", color: "var(--text-muted)" },
    all: { label: "Team", icon: "ph-users", color: "var(--indigo)" },
    admin: { label: "Admins Only", icon: "ph-shield-check", color: "var(--amber)" }
  };
  const scope = visibilityLabels[props.visibility || "private"];

  const contentEl = document.getElementById("sp-content");
  contentEl.innerHTML = `
    <div style="flex: 1;">
      <div style="margin-bottom: 16px;">
        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px;">
           <i class="ph ${scope.icon}" style="color: ${scope.color}; font-size: 14px;"></i>
           <span style="font-size: 12px; font-weight: 600; color: ${scope.color}; text-transform: uppercase; letter-spacing: 0.5px;">${scope.label}</span>
        </div>
        <h3 style="font-size: 18px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">${sanitizeHtml(event.title)}</h3>
        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">${timeStr}</div>
        <div style="font-size: 14px; line-height: 1.5; color: var(--text-primary); white-space: pre-wrap;">${sanitizeHtml(props.description || "No description provided.")}</div>
      </div>
      ${docsHtml}
    </div>
    
    <div style="display: flex; justify-content: space-between; gap: 10px; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border-glass);">
      ${actionsHtml}
    </div>
  `;

  openSidePanel();
};

window.deleteEvent = async () => {
  if (!currentEventContext) return;
  
  const confirmed = await showConfirm("Delete this custom event?", "Delete");
  if (!confirmed) return;

  try {
    await deleteDoc(doc(db, "events", currentEventContext.extendedProps.originalId));
    showToast("Event deleted", "success");
    closeSidePanel();
  } catch (err) {
    console.error(err);
    showToast("Failed to delete event", "error");
  }
};

window.goToTask = () => {
  if (!currentEventContext || currentEventContext.extendedProps.type !== "task") return;
  window.location.href = `task-detail.html?id=${currentEventContext.extendedProps.originalId}`;
};

window.openEditEvent = () => {
  if (!currentEventContext) return;
  const props = currentEventContext.extendedProps;
  
  document.getElementById("event-form").reset();
  document.getElementById("ev-id").value = props.originalId;
  document.getElementById("ev-title").value = currentEventContext.title;
  document.getElementById("ev-desc").value = props.description || "";
  document.getElementById("ev-visibility").value = props.visibility || "private";

  const startStr = currentEventContext.startStr || currentEventContext.start.toISOString();
  const endStr = currentEventContext.endStr || currentEventContext.end.toISOString();

  const startFp = document.getElementById("ev-start")._flatpickr;
  if (startFp) startFp.setDate(startStr);
  else document.getElementById("ev-start").value = startStr.slice(0, 16);

  const endFp = document.getElementById("ev-end")._flatpickr;
  if (endFp) endFp.setDate(endStr);
  else document.getElementById("ev-end").value = endStr.slice(0, 16);

  document.querySelector("#event-modal .modal-title").textContent = "Edit Event";
  document.getElementById("event-form-submit").textContent = "Update Event";
  
  closeSidePanel();
  openModal("event-modal");
};

// ─── Modal helpers ────────────────────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id)?.classList.add("active");
}
window.closeModal = (id) => document.getElementById(id)?.classList.remove("active");
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal-overlay")) e.target.classList.remove("active");
});
