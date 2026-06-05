# NeonSync ✨

<div align="center">
  <p><strong>A full production-ready Team Management & Collaboration web application.</strong></p>
</div>

NeonSync is a comprehensive workspace tool designed to streamline team collaboration, project management, and communication. Built with vanilla web technologies and powered by Firebase, it offers a seamless, real-time experience without the overhead of heavy front-end frameworks.

---

## 🌟 Key Features

- **📊 Interactive Dashboard**: Get a birds-eye view of your tasks, progress, and upcoming deadlines with beautiful charts and visual indicators.
- **✅ Advanced Task Management**: Assign tasks, set priorities, track completion percentages via interactive rings, and upload attachments.
- **📅 Interactive Calendar**: View deadlines, tasks, and custom events on a fully featured, mobile-friendly monthly/weekly/daily calendar.
- **💬 Real-Time Chat**: Dedicated chat rooms for the whole company, specific admin groups, or individual tasks.
- **💡 Idea Library**: Capture, organize, and star your team's best ideas with category filtering and reference linking.
- **👥 Role-Based Access Control**: Four distinct roles — `Super Admin`, `Admin`, `Member`, and `College Ambassador` — ensuring secure access to capacity planning, analytics, and user management.
- **📈 Analytics & Capacity Planning**: Admins can track team velocity, monitor individual workload capacity, and balance tasks effectively.
- **🏢 Multi-Tenant Workspaces**: Users can create a new company workspace or join an existing one using a unique company code.
- **🌗 Dark/Light Mode**: First-class support for both dark and light themes, remembering user preferences across sessions.
- **🔔 Real-Time Notifications**: Get alerted instantly about new tasks, approaching deadlines, remarks, and chat messages.

---

## 🛠️ Technology Stack

- **Frontend**: HTML5, CSS3 (Vanilla), JavaScript (ES6+ Modules)
- **Backend/Database**: Firebase Firestore (Real-time NoSQL Database)
- **Authentication**: Firebase Authentication (Email/Password & Google OAuth)
- **Hosting**: Firebase Hosting (or any static hosting provider)
- **Icons**: Phosphor Icons
- **Libraries**: FullCalendar.js (Calendar), Chart.js (Analytics), Flatpickr (Date picking)

---

## 🚀 Getting Started

### Prerequisites

You need a Firebase project set up with **Authentication** (Email/Password and Google sign-in enabled) and **Firestore Database** enabled.

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/Infinus-77/NeonSync.git
   cd NeonSync
   ```

2. **Configure Firebase**
   - Open `firebase-config.js`
   - Replace the `firebaseConfig` object with your project's configuration details from the Firebase Console.

3. **Serve Locally**
   Because this project uses ES6 modules (`type="module"`), you must serve it over a local HTTP server rather than opening the HTML files directly.
   
   Using Python:
   ```bash
   python -m http.server 8000
   ```
   
   Or using Node.js (http-server):
   ```bash
   npx http-server
   ```

4. **Open the app**
   Navigate to `http://localhost:8000` (or your chosen port) in your browser.

---

## 🔒 Security Rules

For the application to function correctly and securely, ensure your Firestore security rules are configured to match the application's data model. The data is partitioned by `companyId` to ensure data isolation between different workspaces.

---

## 📱 Responsive Design

NeonSync is designed with a mobile-first approach. The sidebar collapses into a hamburger menu, data tables become scrollable, and grids automatically adjust to fit smaller screens, ensuring a premium experience on both desktop and mobile devices.

---

## 📝 License

This project is proprietary and intended for internal use. All rights reserved.
