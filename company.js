import { db } from "./firebase-config.js";
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { requireAuth } from "./auth-guard.js";
import { renderSidebar } from "./sidebar.js";
import { sanitizeHtml, showToast } from "./utils.js";

let currentUser = null;
let companyData = null;

requireAuth(async (user) => {
  currentUser = user;
  if (!currentUser) return;
  
  renderSidebar("company", currentUser);
  await loadCompanyProfile();

  // Setup Edit Modal
  const editBtn = document.getElementById("edit-company-btn");
  const modal = document.getElementById("edit-company-modal");
  const closeBtn = document.getElementById("close-edit-company-modal");
  const cancelBtn = document.getElementById("cancel-edit-company");
  const form = document.getElementById("edit-company-form");

  if (currentUser.role === "super_admin") {
    editBtn.style.display = "inline-flex";
  }

  editBtn.addEventListener("click", () => {
    if (!companyData) return;
    
    // Populate form
    document.getElementById("edit-c-name").value = companyData.name || "";
    document.getElementById("edit-c-industry").value = companyData.industry || "";
    document.getElementById("edit-c-logo").value = companyData.logoUrl || "";
    document.getElementById("edit-c-website").value = companyData.website || "";
    document.getElementById("edit-c-description").value = companyData.description || "";
    document.getElementById("edit-c-address").value = companyData.address || "";
    
    modal.classList.add("active");
  });

  const closeModal = () => modal.classList.remove("active");
  closeBtn.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (currentUser.role !== "super_admin") {
      showToast("Only super admins can edit company details.", "error");
      return;
    }

    const saveBtn = document.getElementById("save-company-btn");
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<i class="ph ph-spinner ph-spin"></i> Saving...`;

    const newDetails = {
      name: document.getElementById("edit-c-name").value.trim(),
      industry: document.getElementById("edit-c-industry").value.trim(),
      logoUrl: document.getElementById("edit-c-logo").value.trim(),
      website: document.getElementById("edit-c-website").value.trim(),
      description: document.getElementById("edit-c-description").value.trim(),
      address: document.getElementById("edit-c-address").value.trim(),
    };

    try {
      await updateDoc(doc(db, "companies", currentUser.companyId), newDetails);
      showToast("Company details updated!", "success");
      closeModal();
      
      // Update local state and re-render
      companyData = { ...companyData, ...newDetails };
      renderCompanyDetails();
      
      // We also trigger a re-render of sidebar so the company name there updates
      // This is a bit hacky but works for the current session. 
      // Re-render sidebar without full page reload:
      renderSidebar("company", currentUser);
      
    } catch (err) {
      console.error("Error updating company:", err);
      showToast(err.message, "error");
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = `Save Changes`;
    }
  });

  // Setup Copy Code Button
  document.getElementById("copy-code-btn").addEventListener("click", () => {
    if (!currentUser.companyId) return;
    navigator.clipboard.writeText(currentUser.companyId).then(() => {
      showToast("Company code copied to clipboard!", "success");
    }).catch(() => {
      showToast("Failed to copy code", "error");
    });
  });
});

async function loadCompanyProfile() {
  if (!currentUser.companyId) {
    showToast("You are not associated with any company.", "error");
    return;
  }

  try {
    const snap = await getDoc(doc(db, "companies", currentUser.companyId));
    if (snap.exists()) {
      companyData = snap.data();
      renderCompanyDetails();
    } else {
      document.getElementById("display-company-name").textContent = "Company Not Found";
    }
  } catch (err) {
    console.error("Error fetching company details:", err);
    showToast("Error loading company profile.", "error");
  }
}

function renderCompanyDetails() {
  if (!companyData) return;

  const logoContainer = document.getElementById("display-company-logo");
  if (companyData.logoUrl) {
    logoContainer.innerHTML = `<img src="${sanitizeHtml(companyData.logoUrl)}" alt="Company Logo" style="width:100%; height:100%; object-fit:cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='';">
                               <i class="ph ph-buildings" style="display:none;"></i>`;
  } else {
    logoContainer.innerHTML = `<i class="ph ph-buildings"></i>`;
  }

  document.getElementById("display-company-name").textContent = sanitizeHtml(companyData.name || "Unknown Company");
  document.getElementById("display-company-id").textContent = sanitizeHtml(currentUser.companyId);
  
  document.getElementById("display-industry").textContent = sanitizeHtml(companyData.industry || "Not specified");
  
  const websiteEl = document.getElementById("display-website");
  if (companyData.website) {
    let url = companyData.website;
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
    }
    websiteEl.href = url;
    websiteEl.textContent = sanitizeHtml(companyData.website);
  } else {
    websiteEl.removeAttribute("href");
    websiteEl.textContent = "Not specified";
    websiteEl.style.color = "var(--text-muted)";
  }

  document.getElementById("display-description").textContent = sanitizeHtml(companyData.description || "No description provided.");
  document.getElementById("display-address").textContent = sanitizeHtml(companyData.address || "No address provided.");
}
