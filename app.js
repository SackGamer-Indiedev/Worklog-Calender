// ============================================================
//  Sai's Worklog Calendar — app.js
//  Firebase v10 (modular) + Firestore + Google Auth
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  collection,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ─── Firebase config ────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyAHzmBZ7HZSV-iTzepIGluL8iWtw6rgh5A",
  authDomain: "worklog-app-142b7.firebaseapp.com",
  projectId: "worklog-app-142b7",
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ─── State ──────────────────────────────────────────────────
let currentUser   = null;
let data          = {};   // { 'YYYY-MM-DD': [{id, text, done}] }
let notes         = [];   // [{id, text, color}]
let currentDate   = new Date();
let selectedDateStr = null;
let firestoreUnsub  = null;  // unsubscribe fn for live listener
let saveTimeout     = null;  // debounce timer

// ─── Constants ──────────────────────────────────────────────
const LS_TASKS = 'worklog-data';
const LS_NOTES = 'worklog-notes';
const MAX_PREVIEW = 3;
const NOTE_COLORS = ['#FBF3DB','#E7F3F8','#FAE4E4','#E9F3E9','#EFE7F8','#FDEBE0'];
const WEEKDAYS     = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const FULL_DAYS    = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS       = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ─── DOM refs ────────────────────────────────────────────────
const authGate   = document.getElementById('authGate');
const appRoot    = document.getElementById('appRoot');
const signInBtn  = document.getElementById('signInBtn');
const signOutBtn = document.getElementById('signOutBtn');
const userAvatar = document.getElementById('userAvatar');
const userName   = document.getElementById('userName');

const calendarGrid = document.getElementById('calendarGrid');
const monthLabel   = document.getElementById('monthLabel');
const monthCount   = document.getElementById('monthCount');
const syncStatus   = document.getElementById('syncStatus');
const overlay      = document.getElementById('overlay');
const modalTitle   = document.getElementById('modalTitle');
const modalSubtitle = document.getElementById('modalSubtitle');
const taskList     = document.getElementById('taskList');
const taskInput    = document.getElementById('taskInput');
const addBtn       = document.getElementById('addBtn');
const saveStatus   = document.getElementById('saveStatus');
const notesList    = document.getElementById('notesList');
const dueList      = document.getElementById('dueList');


// ============================================================
//  AUTH
// ============================================================

onAuthStateChanged(auth, user => {
  if (user) {
    currentUser = user;
    showApp(user);
    startFirestoreSync(user.uid);
  } else {
    currentUser = null;
    showAuthGate();
    if (firestoreUnsub) firestoreUnsub();
  }
});

signInBtn.addEventListener('click', async () => {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    console.error('Sign-in error:', e);
  }
});

signOutBtn.addEventListener('click', () => signOut(auth));

function showApp(user) {
  authGate.style.display = 'none';
  appRoot.style.display  = 'block';
  userName.textContent   = user.displayName || user.email;
  if (user.photoURL) {
    userAvatar.src = user.photoURL;
    userAvatar.style.display = 'block';
  }
  updateClock();
  updateQuote();
  setInterval(updateClock, 1000);
  setInterval(updateQuote, 60000);
}

function showAuthGate() {
  authGate.style.display = 'flex';
  appRoot.style.display  = 'none';
}


// ============================================================
//  FIRESTORE SYNC
//  Structure:
//    /users/{uid}/worklog/tasks  → { data: {...} }
//    /users/{uid}/worklog/notes  → { notes: [...] }
// ============================================================

function startFirestoreSync(uid) {
  // Load from localStorage first so app feels instant
  loadFromLocalStorage();
  render();
  renderNotes();

  // Then set up real-time listener for tasks
  const tasksRef = doc(db, 'users', uid, 'worklog', 'tasks');
  firestoreUnsub = onSnapshot(tasksRef, snap => {
    if (snap.exists()) {
      const remote = snap.data().data || {};
      // Merge: remote wins (multi-device source of truth)
      data = remote;
      saveToLocalStorage();
    }
    render();
    setSyncStatus('synced');
  }, err => {
    console.error('Firestore error:', err);
    setSyncStatus('offline');
  });

  // Notes: load once (less critical for real-time)
  const notesRef = doc(db, 'users', uid, 'worklog', 'notes');
  getDoc(notesRef).then(snap => {
    if (snap.exists()) {
      notes = snap.data().notes || [];
      saveNotesToLocalStorage();
      renderNotes();
    }
  });
}

function setSyncStatus(state) {
  if (state === 'synced')  syncStatus.textContent = '● synced';
  if (state === 'saving')  syncStatus.textContent = '○ saving…';
  if (state === 'offline') syncStatus.textContent = '○ offline';
  syncStatus.style.color = state === 'synced' ? 'var(--accent)' : 'var(--ink-soft)';
}

// Debounced save — waits 800ms after last change before writing to Firestore
function scheduleSave() {
  setSyncStatus('saving');
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => persistToFirestore(), 800);
}

async function persistToFirestore() {
  if (!currentUser) return;
  try {
    const uid = currentUser.uid;
    await setDoc(
      doc(db, 'users', uid, 'worklog', 'tasks'),
      { data }
    );
    await setDoc(
      doc(db, 'users', uid, 'worklog', 'notes'),
      { notes }
    );
    setSyncStatus('synced');
    saveStatus.textContent = 'Saved';
    setTimeout(() => { if (saveStatus.textContent === 'Saved') saveStatus.textContent = ''; }, 1200);
  } catch (e) {
    setSyncStatus('offline');
    saveStatus.textContent = 'Could not save — check connection';
    console.error('Firestore save error:', e);
  }
}


// ============================================================
//  LOCAL STORAGE (instant-load cache)
// ============================================================

function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LS_TASKS);
    data = raw ? JSON.parse(raw) : {};
  } catch { data = {}; }

  try {
    const raw = localStorage.getItem(LS_NOTES);
    notes = raw ? JSON.parse(raw) : [];
  } catch { notes = []; }
}

function saveToLocalStorage() {
  try { localStorage.setItem(LS_TASKS, JSON.stringify(data)); } catch { }
}

function saveNotesToLocalStorage() {
  try { localStorage.setItem(LS_NOTES, JSON.stringify(notes)); } catch { }
}


// ============================================================
//  HELPERS
// ============================================================

function pad(n) { return n.toString().padStart(2, '0'); }
function dateKey(y, m, d) { return `${y}-${pad(m + 1)}-${pad(d)}`; }
function todayKey() {
  const t = new Date();
  return dateKey(t.getFullYear(), t.getMonth(), t.getDate());
}


// ============================================================
//  CALENDAR RENDER
// ============================================================

function render() {
  const y = currentDate.getFullYear();
  const m = currentDate.getMonth();
  monthLabel.textContent = `${MONTHS[m]} ${y}`;

  calendarGrid.innerHTML = '';

  // Weekday headers
  WEEKDAYS.forEach(d => {
    const el = document.createElement('div');
    el.className = 'weekday';
    el.textContent = d;
    calendarGrid.appendChild(el);
  });

  const firstDay      = new Date(y, m, 1).getDay();
  const daysInMonth   = new Date(y, m + 1, 0).getDate();
  const daysInPrevMo  = new Date(y, m, 0).getDate();
  const tKey          = todayKey();
  let totalThisMonth  = 0;

  // Leading days
  for (let i = firstDay - 1; i >= 0; i--) {
    calendarGrid.appendChild(buildCell(y, m - 1, daysInPrevMo - i, true, tKey));
  }

  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    const key = dateKey(y, m, d);
    if (data[key]?.length) totalThisMonth += data[key].length;
    calendarGrid.appendChild(buildCell(y, m, d, false, tKey));
  }

  // Trailing days
  const trailing = (7 - ((firstDay + daysInMonth) % 7)) % 7;
  for (let d = 1; d <= trailing; d++) {
    calendarGrid.appendChild(buildCell(y, m + 1, d, true, tKey));
  }

  monthCount.textContent = totalThisMonth === 0
    ? 'No entries logged yet'
    : `${totalThisMonth} ${totalThisMonth === 1 ? 'entry' : 'entries'} logged`;

  renderDueList(tKey);
}

function buildCell(y, m, d, otherMonth, tKey) {
  const norm = new Date(y, m, d);
  const ny = norm.getFullYear(), nm = norm.getMonth(), nd = norm.getDate();
  const key = dateKey(ny, nm, nd);

  const cell = document.createElement('div');
  cell.className = 'day-cell'
    + (otherMonth ? ' other-month' : '')
    + (key === tKey ? ' today' : '');

  const num = document.createElement('div');
  num.className = 'day-number';
  num.textContent = nd;
  cell.appendChild(num);

  const tasks = data[key] || [];
  if (tasks.length) {
    const list = document.createElement('div');
    list.className = 'cell-tasks';
    tasks.slice(0, MAX_PREVIEW).forEach(t => {
      const row = document.createElement('div');
      row.className = 'cell-task' + (t.done ? ' done' : '');
      const dot = document.createElement('span');
      dot.className = 'dot';
      const txt = document.createElement('span');
      txt.textContent = t.text;
      row.appendChild(dot);
      row.appendChild(txt);
      list.appendChild(row);
    });
    cell.appendChild(list);

    if (tasks.length > MAX_PREVIEW) {
      const more = document.createElement('div');
      more.className = 'cell-more';
      more.textContent = `+${tasks.length - MAX_PREVIEW} more`;
      cell.appendChild(more);
    }
  }

  if (!otherMonth) {
    cell.addEventListener('click', () => openModal(key, ny, nm, nd));
  }

  return cell;
}


// ============================================================
//  OVERDUE PANEL
// ============================================================

function renderDueList(tKey) {
  const items = [];
  Object.keys(data).forEach(key => {
    if (key < tKey) {
      (data[key] || []).forEach(t => {
        if (!t.done) items.push({ key, text: t.text });
      });
    }
  });
  items.sort((a, b) => a.key.localeCompare(b.key));

  dueList.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'panel-empty';
    empty.textContent = "Nothing overdue — you're all caught up.";
    dueList.appendChild(empty);
    return;
  }

  items.forEach(item => {
    const [y, m, d] = item.key.split('-').map(Number);
    const el = document.createElement('div');
    el.className = 'due-item';

    const dateEl = document.createElement('div');
    dateEl.className = 'due-date';
    dateEl.textContent = `${SHORT_MONTHS[m - 1]} ${d}`;

    const textEl = document.createElement('div');
    textEl.className = 'due-text';
    textEl.textContent = item.text;

    el.appendChild(dateEl);
    el.appendChild(textEl);
    el.addEventListener('click', () => openModal(item.key, y, m - 1, d));
    dueList.appendChild(el);
  });
}


// ============================================================
//  MODAL
// ============================================================

function openModal(key, y, m, d) {
  selectedDateStr = key;
  modalTitle.textContent   = `${MONTHS[m]} ${d}`;
  modalSubtitle.textContent = `${FULL_DAYS[new Date(y, m, d).getDay()]} · ${y}`;
  saveStatus.textContent   = '';
  taskInput.value          = '';
  renderTaskList();
  overlay.classList.add('open');
  setTimeout(() => taskInput.focus(), 100);
}

function closeModal() {
  overlay.classList.remove('open');
  selectedDateStr = null;
}

function renderTaskList() {
  const tasks = data[selectedDateStr] || [];
  taskList.innerHTML = '';

  if (!tasks.length) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'Nothing logged for this day yet.';
    taskList.appendChild(empty);
    return;
  }

  tasks.forEach(task => {
    const li = document.createElement('li');
    li.className = 'task-item';

    const checkbox = document.createElement('input');
    checkbox.type    = 'checkbox';
    checkbox.checked = !!task.done;
    checkbox.addEventListener('change', () => {
      task.done = checkbox.checked;
      renderTaskList();
      saveAndRefresh();
    });

    const text = document.createElement('span');
    text.className = 'task-text' + (task.done ? ' done' : '');
    text.textContent = task.text;
    text.title       = 'Double-click to edit';
    text.addEventListener('dblclick', () => startEditingTask(li, task));

    const del = document.createElement('button');
    del.className   = 'delete-task';
    del.textContent = '✕';
    del.title       = 'Remove';
    del.addEventListener('click', () => {
      data[selectedDateStr] = (data[selectedDateStr] || []).filter(t => t.id !== task.id);
      if (!data[selectedDateStr].length) delete data[selectedDateStr];
      renderTaskList();
      saveAndRefresh();
    });

    li.appendChild(checkbox);
    li.appendChild(text);
    li.appendChild(del);
    taskList.appendChild(li);
  });
}

function startEditingTask(li, task) {
  const existingText = li.querySelector('.task-text');
  if (!existingText) return;

  const input = document.createElement('input');
  input.type      = 'text';
  input.className = 'task-edit-input';
  input.value     = task.text;
  input.maxLength = 200;
  li.replaceChild(input, existingText);
  input.focus();
  input.select();

  let finished = false;
  function commit() {
    if (finished) return;
    finished = true;
    const newText = input.value.trim();
    if (newText) task.text = newText;
    renderTaskList();
    saveAndRefresh();
  }
  function cancel() {
    if (finished) return;
    finished = true;
    renderTaskList();
  }

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
}

function addTask() {
  const text = taskInput.value.trim();
  if (!text || !selectedDateStr) return;
  if (!data[selectedDateStr]) data[selectedDateStr] = [];
  data[selectedDateStr].push({
    id:   Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    text,
    done: false
  });
  taskInput.value = '';
  renderTaskList();
  saveAndRefresh();
  taskInput.focus();
}

function saveAndRefresh() {
  saveToLocalStorage();
  scheduleSave();
  render();
}


// ============================================================
//  STICKY NOTES
// ============================================================

function renderNotes() {
  notesList.innerHTML = '';

  if (!notes.length) {
    const empty = document.createElement('div');
    empty.className  = 'panel-empty';
    empty.textContent = 'Nothing here yet — jot down a reminder.';
    notesList.appendChild(empty);
    return;
  }

  notes.forEach((note, idx) => {
    const card = document.createElement('div');
    card.className      = 'note-card';
    card.style.background = NOTE_COLORS[idx % NOTE_COLORS.length];

    const textarea = document.createElement('textarea');
    textarea.className   = 'note-text';
    textarea.value       = note.text;
    textarea.placeholder = 'Type a note…';
    textarea.rows        = 1;

    const autoResize = () => {
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';
    };

    textarea.addEventListener('input', () => {
      note.text = textarea.value;
      autoResize();
      saveNotesToLocalStorage();
      scheduleSave();
    });

    const del = document.createElement('button');
    del.className   = 'note-delete';
    del.textContent = '✕';
    del.title       = 'Remove note';
    del.addEventListener('click', () => {
      notes = notes.filter(n => n.id !== note.id);
      saveNotesToLocalStorage();
      scheduleSave();
      renderNotes();
    });

    card.appendChild(del);
    card.appendChild(textarea);
    notesList.appendChild(card);
    autoResize();
  });
}

function addNote() {
  notes.push({
    id:   Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    text: ''
  });
  saveNotesToLocalStorage();
  scheduleSave();
  renderNotes();
  const textareas = notesList.querySelectorAll('.note-text');
  textareas[textareas.length - 1]?.focus();
}


// ============================================================
//  CLOCK
// ============================================================

function updateClock() {
  const now = new Date();
  document.getElementById('clockDate').textContent =
    `${FULL_DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}`;
  document.getElementById('clockTime').textContent =
    now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}


// ============================================================
//  ANIME QUOTES  (200+)
// ============================================================

const QUOTES = [
  ["I'm gonna be King of the Pirates!", "Luffy", "One Piece"],
  ["The one with the most freedom on this sea is the Pirate King.", "Luffy", "One Piece"],
  ["Power isn't determined by your size, but by the size of your heart and dreams.", "Monkey D. Luffy", "One Piece"],
  ["When do people really die? When they're forgotten.", "Dr. Hiluluk", "One Piece"],
  ["If you don't take risks, you can't create a future.", "Monkey D. Luffy", "One Piece"],
  ["A scar on the back is a swordsman's shame.", "Roronoa Zoro", "One Piece"],
  ["I'll become stronger, no matter what it takes.", "Roronoa Zoro", "One Piece"],
  ["The dreams of those who came before us cannot be stopped.", "Gol D. Roger", "One Piece"],
  ["Nothing happened.", "Roronoa Zoro", "One Piece"],
  ["I'll keep getting stronger until the whole world recognizes my crew.", "Luffy", "One Piece"],
  ["Wealth, fame, power — one man had it all: the King of the Pirates.", "Narrator", "One Piece"],
  ["The sea is vast. Why should I be afraid of it?", "Nami", "One Piece"],
  ["I refuse to give up. Ever.", "Asta", "Black Clover"],
  ["Even if we're laughed at, our path is to keep moving forward.", "Asta", "Black Clover"],
  ["I'm not a genius, so I'll work harder than anyone else.", "Asta", "Black Clover"],
  ["A person's worth is decided by themselves, not by anyone else.", "Yuno", "Black Clover"],
  ["No matter how many times I'm knocked down, I'll stand back up.", "Asta", "Black Clover"],
  ["Power isn't a privilege only for the talented.", "Asta", "Black Clover"],
  ["I'll become the Wizard King — that's a promise I'll never break.", "Asta", "Black Clover"],
  ["Hard work betrays no one.", "Asta", "Black Clover"],
  ["Even with nothing, effort can still overcome anything.", "Asta", "Black Clover"],
  ["Don't let anyone tell you what you can't become.", "Asta", "Black Clover"],
  ["If you can't do it with magic, do it without.", "Asta", "Black Clover"],
  ["No matter who stands in my way, I'll keep moving forward.", "Asta", "Black Clover"],
  ["I'll take a potato chip... and eat it!", "Light Yagami", "Death Note"],
  ["The world is rotten, and those who make it rot deserve judgment.", "Light Yagami", "Death Note"],
  ["I am justice.", "Light Yagami", "Death Note"],
  ["Just as planned.", "L", "Death Note"],
  ["Humans really are interesting creatures.", "Ryuk", "Death Note"],
  ["Whether it's heaven or hell, I'll take you with me.", "Light Yagami", "Death Note"],
  ["Believe it!", "Naruto Uzumaki", "Naruto"],
  ["Hard work is worthless for those who don't believe in themselves.", "Naruto Uzumaki", "Naruto"],
  ["A person grows up when they're able to overcome hardship.", "Jiraiya", "Naruto"],
  ["I never go back on my word — that's my ninja way.", "Naruto Uzumaki", "Naruto"],
  ["When people protect something truly precious, that's when they're strongest.", "Naruto Uzumaki", "Naruto"],
  ["The pain of being alone — only those who've felt it can understand it.", "Gaara", "Naruto"],
  ["Talent doesn't mean a thing — it's effort that counts.", "Rock Lee", "Naruto"],
  ["I'll never run away, no matter what.", "Naruto Uzumaki", "Naruto"],
  ["In this world, wherever there is light, there are also shadows.", "Madara Uchiha", "Naruto"],
  ["People change when they understand each other.", "Naruto Uzumaki", "Naruto"],
  ["If you don't fight, you can't win.", "Eren Yeager", "Attack on Titan"],
  ["The world is cruel, but it's also beautiful.", "Mikasa Ackerman", "Attack on Titan"],
  ["Keep moving forward — that's the only way to survive.", "Hange Zoë", "Attack on Titan"],
  ["Fight, and you might lose. Don't fight, and you've already lost.", "Armin Arlert", "Attack on Titan"],
  ["Dedicate your hearts.", "Survey Corps", "Attack on Titan"],
  ["The only way to escape that cycle is to keep moving forward.", "Armin Arlert", "Attack on Titan"],
  ["Go beyond! Plus Ultra!", "All Might", "My Hero Academia"],
  ["It's fine to cry, but giving up is a different story.", "Tenya Iida", "My Hero Academia"],
  ["A hero keeps moving forward even when everyone else has given up.", "All Might", "My Hero Academia"],
  ["When you fall down, you have a choice — get up or stay down.", "Izuku Midoriya", "My Hero Academia"],
  ["I want to be someone who saves people with a smile.", "Izuku Midoriya", "My Hero Academia"],
  ["Have faith in your friends and keep moving forward.", "Izuku Midoriya", "My Hero Academia"],
  ["Real heroes find a way to make the impossible possible.", "Izuku Midoriya", "My Hero Academia"],
  ["Smash through your limits — every single day.", "All Might", "My Hero Academia"],
  ["Even if you're born without a quirk, you can still become a hero.", "Izuku Midoriya", "My Hero Academia"],
  ["Set your heart ablaze.", "Kyojuro Rengoku", "Demon Slayer"],
  ["No matter how many people you lose, you have no choice but to keep living.", "Tanjiro Kamado", "Demon Slayer"],
  ["Whatever happens from here, I refuse to regret the choices I make.", "Tanjiro Kamado", "Demon Slayer"],
  ["Keep pushing forward — that's the path you've chosen.", "Giyu Tomioka", "Demon Slayer"],
  ["A demon's strength is nothing against the will to protect others.", "Tanjiro Kamado", "Demon Slayer"],
  ["Open the path to the future for the next generation.", "Kyojuro Rengoku", "Demon Slayer"],
  ["Grow up and become the finest swordsman in the Corps.", "Kyojuro Rengoku", "Demon Slayer"],
  ["I haven't lost yet.", "Hinata Shoyo", "Haikyuu!!"],
  ["The view from the top is something only those who keep going can see.", "Wakatoshi Ushijima", "Haikyuu!!"],
  ["There's always something you can do, right up until the end.", "Ittetsu Takeda", "Haikyuu!!"],
  ["Flying isn't about talent — it's about never giving up.", "Hinata Shoyo", "Haikyuu!!"],
  ["A single block won't decide the match — get up and keep playing.", "Keiji Akaashi", "Haikyuu!!"],
  ["Even genius needs effort to keep shining.", "Tobio Kageyama", "Haikyuu!!"],
  ["The moment you give up is the moment you lose.", "Daichi Sawamura", "Haikyuu!!"],
  ["It's not the face that makes someone a monster — it's the choices they make.", "Kite", "Hunter x Hunter"],
  ["Smile, no matter how hard things get.", "Killua Zoldyck", "Hunter x Hunter"],
  ["If you don't like your destiny, don't accept it.", "Gon Freecss", "Hunter x Hunter"],
  ["A person who can't sacrifice anything can't change anything.", "Armin Arlert", "Hunter x Hunter"],
  ["Keep your goal in sight, even when the path gets long.", "Gon Freecss", "Hunter x Hunter"],
  ["Hard work pays off, but smart hard work pays off more.", "Biscuit Krueger", "Hunter x Hunter"],
  ["You should enjoy the little detours in life.", "Ging Freecss", "Hunter x Hunter"],
  ["A lesson without pain is meaningless — you can't gain without sacrifice.", "Edward Elric", "Fullmetal Alchemist"],
  ["Sometimes the things we can't change end up changing us.", "Edward Elric", "Fullmetal Alchemist"],
  ["The world isn't perfect, but it's there for us, doing the best it can.", "Roy Mustang", "Fullmetal Alchemist"],
  ["You can keep moving forward as long as you remember why you started.", "Alphonse Elric", "Fullmetal Alchemist"],
  ["Fear isn't evil — it tells you what your weakness is, so face it and grow.", "Gildarts Clive", "Fullmetal Alchemist"],
  ["Humankind cannot gain anything without first giving something in return.", "Alphonse Elric", "Fullmetal Alchemist"],
  ["Throughout heaven and earth, I alone am the honored one.", "Gojo Satoru", "Jujutsu Kaisen"],
  ["It's not about whether you can — it's about whether you will.", "Yuji Itadori", "Jujutsu Kaisen"],
  ["I'll save as many people as I can, starting with the ones in front of me.", "Yuji Itadori", "Jujutsu Kaisen"],
  ["Don't let regret decide your choices.", "Nanami Kento", "Jujutsu Kaisen"],
  ["Keep your standards high, even when no one's watching.", "Gojo Satoru", "Jujutsu Kaisen"],
  ["No matter how strong the curse, we fight anyway.", "Yuji Itadori", "Jujutsu Kaisen"],
  ["If I don't wield this sword, I can't protect you.", "Ichigo Kurosaki", "Bleach"],
  ["Get up — whatever happens next, you can't face it sitting down.", "Ichigo Kurosaki", "Bleach"],
  ["Strength isn't just physical — it's the will to keep standing.", "Ichigo Kurosaki", "Bleach"],
  ["Even the smallest blade can cut through despair.", "Rukia Kuchiki", "Bleach"],
  ["Protecting someone means being ready to bleed for them.", "Ichigo Kurosaki", "Bleach"],
  ["A true warrior never gives up, even when the odds are impossible.", "Goku", "Dragon Ball Z"],
  ["I am the hope of the universe.", "Goku", "Dragon Ball Z"],
  ["Power comes in response to a need, not a desire.", "Goku", "Dragon Ball Z"],
  ["The harder the battle, the sweeter the victory.", "Vegeta", "Dragon Ball Z"],
  ["Train like your life depends on it — one day it might.", "Vegeta", "Dragon Ball Z"],
  ["Never give up, no matter how strong your enemy seems.", "Goku", "Dragon Ball Z"],
  ["It's not about the power level. It's about the will to surpass it.", "Vegeta", "Dragon Ball Z"],
  ["Whatever happens, happens — just give it your all.", "Saitama", "One Punch Man"],
  ["I just wanted to be strong enough to help anyone in trouble.", "Saitama", "One Punch Man"],
  ["100 push-ups, 100 sit-ups, 100 squats, and a 10km run — every single day.", "Saitama", "One Punch Man"],
  ["Being a hero doesn't need a reason.", "Saitama", "One Punch Man"],
  ["It's not that I want to fight — it's that I have something to protect.", "Kaneki Ken", "Tokyo Ghoul"],
  ["You can't change who you are, but you can change what you do next.", "Kaneki Ken", "Tokyo Ghoul"],
  ["Even broken, keep walking forward.", "Kaneki Ken", "Tokyo Ghoul"],
  ["The only ones who should kill are those prepared to be killed.", "Lelouch Lamperouge", "Code Geass"],
  ["If your path is one of suffering, you won't walk it alone.", "Lelouch Lamperouge", "Code Geass"],
  ["A king's job is to keep his people moving forward.", "Lelouch Lamperouge", "Code Geass"],
  ["Our scars remind us the past was real, but the future is still ours to write.", "Natsu Dragneel", "Fairy Tail"],
  ["I don't care if it's impossible — I'm doing it anyway.", "Natsu Dragneel", "Fairy Tail"],
  ["Friends are the family we choose for ourselves.", "Erza Scarlet", "Fairy Tail"],
  ["Guts are what make a true wizard.", "Natsu Dragneel", "Fairy Tail"],
  ["Never lose sight of your nakama, no matter how hard the fight.", "Erza Scarlet", "Fairy Tail"],
  ["The bonds we make give us the power to keep going.", "Lucy Heartfilia", "Fairy Tail"],
  ["I don't want to become a perfect soldier — I want to be the best version of me.", "Fairy Tail"],
  ["People die when they are killed.", "Shirou Emiya", "Fate/stay night"],
  ["The only way to truly escape the mundane is for you to constantly be evolving.", "Masamune Makabe", "Masamune-kun's Revenge"],
  ["Whatever you lose, you'll find it again. But what you throw away you'll never get back.", "Kenshin Himura", "Rurouni Kenshin"],
  ["To know sorrow is not terrifying. What is terrifying is to know you can't go back to happiness you could have had.", "Matsumoto Rangiku", "Bleach"],
  ["Even if I'm worthless and carry demon blood, I want to live!", "Zenitsu Agatsuma", "Demon Slayer"],
  ["It doesn't matter if I'm small. Even if I can't move a single step forward, I'll still keep fighting!", "Hinata Shoyo", "Haikyuu!!"],
  ["The moment you think of giving up, think of the reason why you held on so long.", "Natsu Dragneel", "Fairy Tail"],
  ["You don't need a reason to help people.", "Zidane Tribal", "Final Fantasy IX"],
  ["I want to be the very best, like no one ever was.", "Ash Ketchum", "Pokémon"],
  ["We are all living our lives running toward our own goals.", "Yuzuru Otonashi", "Angel Beats!"],
  ["There's no such thing as a painless lesson. They just don't exist.", "Edward Elric", "Fullmetal Alchemist"],
  ["When you give up, that's when the game ends.", "Mitsuyoshi Anzai", "Slam Dunk"],
  ["We don't know what kind of people we truly are until the moment before our deaths.", "Itachi Uchiha", "Naruto"],
  ["A dropout will beat a genius through hard work.", "Rock Lee", "Naruto"],
  ["I hate having to try at things.", "Shikamaru Nara", "Naruto"],
  ["Those who cannot acknowledge themselves will eventually fail.", "Itachi Uchiha", "Naruto"],
  ["Reject common sense to make the impossible possible.", "Simon", "Gurren Lagann"],
  ["Don't believe in yourself. Believe in me who believes in you.", "Kamina", "Gurren Lagann"],
  ["Who the hell do you think I am?!", "Kamina", "Gurren Lagann"],
  ["Go forward. Move forward. Only then will you know your own strength.", "Kamina", "Gurren Lagann"],
  ["The two most important days in your life are the day you are born and the day you find out why.", "Vinland Saga"],
  ["You have no enemies. No one in this world has any enemies.", "Thors", "Vinland Saga"],
  ["A real warrior doesn't need a sword.", "Thors", "Vinland Saga"],
  ["That's the only way we'll survive. We have to change the world.", "Thorfinn", "Vinland Saga"],
  ["An unjust peace is better than a just war.", "Vinland Saga"],
  ["Don't try to win. Try to understand.", "Vinland Saga"],
  ["You're weak because you run away. Face your fears head on.", "Mikasa Ackerman", "Attack on Titan"],
  ["Even if we don't understand each other, that's not a reason to reject each other.", "Ryu Honda", "Fruits Basket"],
  ["If you only face forward, there is something you will miss seeing.", "Vash the Stampede", "Trigun"],
  ["Anything can happen. No one said life was easy.", "Takeshi Kovacs", "Altered Carbon"],
  ["People who can't throw something important away, can never hope to change anything.", "Armin Arlert", "Attack on Titan"],
  ["A real ninja never appears before his enemies.", "Kakashi Hatake", "Naruto"],
  ["Even in the most difficult situations, don't give up. Always fight back.", "Erza Scarlet", "Fairy Tail"],
  ["You were born for a reason. That alone should be enough.", "Angel Beats!"],
  ["No matter how much you suffer, never give up on life.", "Guts", "Berserk"],
  ["Survive. Struggle all you want. That's what it means to be alive.", "Griffith", "Berserk"],
  ["If you can't protect your loved ones, all your training means nothing.", "Tanjiro Kamado", "Demon Slayer"],
  ["Once you decide your path, never look back.", "Rurouni Kenshin"],
  ["The world is not beautiful, therefore it is.", "Kino", "Kino's Journey"],
  ["Stand up and walk. Keep moving forward. You've got two good legs, so use them.", "Edward Elric", "Fullmetal Alchemist"],
  ["Every day is a bonus level.", "Saitama", "One Punch Man"],
  ["If you're willing to do whatever it takes, you don't need talent.", "Asta", "Black Clover"],
  ["Push yourself again and again. Don't give an inch until the final buzzer sounds.", "Hanamichi Sakuragi", "Slam Dunk"],
  ["It's not about how hard you hit — it's about how hard you can get hit and keep moving forward.", "Hajime no Ippo"],
  ["Today's pain is tomorrow's power.", "Hajime no Ippo"],
  ["Your daily choices today create tomorrow's results.", "Hajime no Ippo"],
  ["Work hard in silence, let success make the noise.", "Kuroko", "Kuroko no Basket"],
  ["If you've got time to whine, you've got time to train.", "Kuroko no Basket"],
  ["Talent is something you make bloom. Instinct is something you polish.", "Kuroko no Basket"],
  ["Losing is not the opposite of winning — it's part of it.", "Haikyuu!!"],
  ["You won't be able to see the big picture unless you get out in the field and feel it.", "Haikyuu!!"],
  ["Small differences can change everything in the end.", "Haikyuu!!"],
  ["The stronger you become, the more you'll want to protect.", "Demon Slayer"],
  ["You fight to protect people. That's enough reason.", "Demon Slayer"],
  ["Even the darkest night will end and the sun will rise.", "Demon Slayer"],
  ["Your heart will always guide you home.", "One Piece"],
  ["A person's life is worth more than any treasure.", "One Piece"],
  ["Adventure is out there. You just have to take the first step.", "One Piece"],
  ["The sea is vast and full of possibility — just like your future.", "One Piece"],
  ["If no one comes from the future to stop you, how bad can your decision really be?", "One Punch Man"],
  ["Strength can be surpassed, bonds grow, and history will be made.", "My Hero Academia"],
  ["Everything I've built will be worth it in the end.", "Izuku Midoriya", "My Hero Academia"],
  ["Keep going. Not for others — for you.", "My Hero Academia"],
  ["Your effort today is your strength tomorrow.", "Black Clover"],
  ["Grind now. Shine later.", "Black Clover"],
  ["Not everyone is born equal. But we all have 24 hours.", "Black Clover"],
];

let lastQuoteHour = -1;

function updateQuote() {
  const hour = Math.floor(Date.now() / 3600000);
  if (hour === lastQuoteHour) return;
  lastQuoteHour = hour;

  const idx = hour % QUOTES.length;
  const q   = QUOTES[idx];
  const [text, character, series] = Array.isArray(q) && q.length === 3
    ? q : [q[0], q[1], null];
  const label = series
    ? `"${text}" — ${character}, ${series}`
    : `"${text}" — ${character}`;

  const el = document.getElementById('quoteText');
  el.style.opacity = 0;
  setTimeout(() => {
    el.textContent  = label;
    el.style.opacity = 1;
  }, 300);
}


// ============================================================
//  EVENT LISTENERS
// ============================================================

document.getElementById('prevBtn').addEventListener('click', () => {
  currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
  render();
});
document.getElementById('nextBtn').addEventListener('click', () => {
  currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
  render();
});
document.getElementById('todayBtn').addEventListener('click', () => {
  currentDate = new Date();
  render();
});
document.getElementById('closeBtn').addEventListener('click', closeModal);
overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
addBtn.addEventListener('click', addTask);
taskInput.addEventListener('keydown', e => { if (e.key === 'Enter') addTask(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && overlay.classList.contains('open')) closeModal();
});
document.getElementById('addNoteBtn').addEventListener('click', addNote);
