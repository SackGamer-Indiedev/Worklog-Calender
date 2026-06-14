# 📅 Sai's Worklog Calendar

> A personal, minimal work-log app with a monthly calendar view — built to track daily tasks, sticky notes, and overdue items across all devices.

**🔗 Live:** [SackGamer-Indiedev.github.io/Worklog-Calender](https://sackgamer-indiedev.github.io/Worklog-Calender/)

---

## 🎯 Objective

To have one clean place to:
- Log what I got done every day
- See overdue unchecked tasks at a glance
- Jot down quick reminders and notes
- Stay motivated with rotating anime quotes

No bloat. No subscriptions. Just a fast, minimal personal productivity tool that feels good to use.

---

## ✅ Current Features

| Feature | Status |
|---|---|
| Monthly calendar grid (click any day to log tasks) | ✅ Done |
| Add, edit (double-click), check off, delete tasks | ✅ Done |
| All tasks visible inline on the calendar cell | ✅ Done |
| Overdue panel — unchecked past tasks, click to open | ✅ Done |
| Sticky notes panel — colorful quick-reminder cards | ✅ Done |
| Live clock with date and time | ✅ Done |
| 200+ rotating anime quotes (changes every hour) | ✅ Done |
| Custom favicon | ✅ Done |
| Google Sign-In authentication | ✅ Done |
| Firebase Firestore sync (real-time, cross-device) | ✅ Done |
| localStorage cache for instant load | ✅ Done |
| Sync status indicator (synced / saving / offline) | ✅ Done |
| Responsive layout (mobile + desktop) | ✅ Done |
| Notion-minimal design | ✅ Done |

---

## 🗺️ Roadmap

Things planned or being considered — in rough priority order.

### 🔜 Next Up
- [ ] Dark mode toggle (CSS variables are already structured for it)
- [ ] Firebase offline persistence (auto-retry when connection returns)
- [ ] Test and verify cross-device sync on phone + laptop simultaneously

### 🧭 Medium Term
- [ ] Task categories / tags with color coding
- [ ] Week view toggle alongside month view
- [ ] Search tasks across all dates
- [ ] Drag-to-reschedule tasks between days

### 💡 Ideas / Backlog
- [ ] Export tasks to CSV or PDF (date range)
- [ ] PWA support — install to home screen on mobile (`manifest.json` + service worker)
- [ ] Daily or weekly summary (would need Firebase Cloud Functions)
- [ ] Stats view — tasks completed per week/month, streaks

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML, CSS, JavaScript (ES Modules) |
| Auth | Firebase Authentication (Google Sign-In) |
| Database | Firebase Firestore (real-time NoSQL) |
| Hosting | GitHub Pages |
| Fonts | Inter, Source Serif 4, IBM Plex Mono (Google Fonts) |
| Firebase SDK | v10.12.2 (modular, loaded via CDN — no build step) |

No frameworks. No bundler. No npm. Just three files and a CDN.

---

## 📁 File Structure

```
/
├── index.html      ← App shell, auth gate, modal markup
├── style.css       ← All styles (CSS custom properties, no framework)
├── app.js          ← All logic — Firebase, Firestore, auth, calendar, notes, quotes
├── README.md       ← This file
└── HANDOFF.md      ← Technical handoff doc for dev sessions
```

---

## 🔥 Firebase Setup

**Project:** `worklog-app-142b7`  
**Auth:** Google Sign-In (popup)  
**Database:** Firestore

### Firestore Data Structure
```
/users/{uid}/worklog/tasks  →  { data: { 'YYYY-MM-DD': [{id, text, done}] } }
/users/{uid}/worklog/notes  →  { notes: [{id, text}] }
```

### Security Rules (set in Firebase Console → Firestore → Rules)
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

### Authorized Domain
Add `thisisggsai.github.io` under **Firebase Console → Authentication → Settings → Authorized Domains**.

---

## 🚀 Deployment

This is a static site — no build step needed.

1. Edit `index.html`, `style.css`, or `app.js` directly in the GitHub web editor
2. Commit to `main`
3. GitHub Pages auto-deploys within ~30 seconds
4. Visit [thisisggsai.github.io/Worklog-Calender](https://thisisggsai.github.io/Worklog-Calender/) to verify

> ⚠️ `app.js` uses ES modules (`type="module"`). It will not work when opened as a local `file://` — always test via the GitHub Pages URL or a local HTTP server.

---

## 📖 Anime Quote Sources

Quotes rotate every hour from a pool of 200+ lines across:
One Piece · Black Clover · Death Note · Naruto · Attack on Titan · My Hero Academia · Demon Slayer · Haikyuu!! · Hunter x Hunter · Fullmetal Alchemist · Jujutsu Kaisen · Bleach · Dragon Ball Z · One Punch Man · Tokyo Ghoul · Code Geass · Fairy Tail · Gurren Lagann · Vinland Saga · Berserk · and more

---

## 📝 Changelog

### June 2026
- Migrated from single `worklog.html` to split `index.html` + `style.css` + `app.js`
- Added Firebase Firestore real-time sync + Google Sign-In
- localStorage cache for instant load, debounced Firestore writes
- Added sync status indicator in calendar toolbar
- User avatar + name + sign-out in header
- 200+ anime quotes added (was ~100 previously)

### Earlier
- Initial build: monthly calendar, task add/edit/delete/check
- Added sticky notes panel (left sidebar)
- Added overdue tasks panel (right sidebar)
- Added live clock and date display
- Added custom SVG favicon
- Switched storage from Claude artifact storage → `localStorage`
- Renamed app to "Sai's Worklog Calendar"
- Deployed to GitHub Pages at `thisisggsai.github.io/Worklog-Calender`

---

*Built with Claude · Hosted on GitHub Pages · Powered by Firebase*
