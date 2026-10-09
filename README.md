# ⚔️ Study Duel — installable app (English + Egyptian Arabic)

Challenge your friends to study more. Log sessions, earn points, keep streaks, chat, and when the round ends the app
picks a **random reward for the winner** and a **random punishment for the loser**.

- 👥 Parties of up to **8 players**, or **solo** mode (hit your target = reward, miss = punishment)
- 🔒 **Invite-only:** the host gets a **QR code + link** (visible to the host only). Nobody can join without it.
- 👑 **Host-only controls:** round settings, prize lists, removing members, revealing results
- 🌍 **English and Egyptian Arabic** (right-to-left), auto-selected from the phone's language, with a 🌐 switch
- 📲 **Installs like an app** from a link or QR code (and you can turn it into a real **APK**, see below)

## 🆕 What's new in v4.0 (final edits)
Replace these 5 files on your host and redeploy: `index.html`, `app.js`, `i18n.js`, `sw.js`, `README.md`.
**No Firestore rules change and no new setup are needed.** Installed phones/APK update by themselves.

- 💬 **Separate chats** — a *Chats* list with the party chat plus one private chat per person (last message + unread count). Tap one to open its own page; tap *Chat* again to go back.
- 🗑️ **Deleted messages notify everyone in that chat** — a deleted message stays as "This message was deleted" and the others get a notification.
- 🌙 **Focus mode** — pick minutes and start. A 🌙 shows next to your avatar for the whole party (arena, leaderboard, members, chats), and your notifications go quiet.
  While it runs, phone use costs points: the app watches for the phone being held/moved, screen taps, and leaving then returning to the app
  (30 s of use = −1 point, picking the phone up = −1; the loss is capped at what a normal study session of that length earns). Finish clean and you earn a bonus (+1 per 10 min).
  Strictness (Relaxed / Normal / Strict) is in Settings. *A web app cannot see what you do inside other apps; it only notices you left and came back.*
- 🎯 **Missions** — instead of logging what you studied, type it as a mission (with planned time + difficulty), add as many as you want per day, and tick the square to earn the points. Unfinished ones can be moved to today.
- 🔔 **Notifications** — new messages, deleted messages, focus finished, and a daily "you haven't studied yet" reminder at a time you choose.
  They arrive while the app is open or alive in the background. Without a paid server (Firebase Cloud Functions) a phone that has fully closed the app can't be pushed to, so alerts then wait until you open it.
- 🎨 **Calmer UI** — softer colours, less animation, cleaner cards, light/dark/auto.
- ⚙️ **Settings & help** (⚙️ icon in the header) — language, theme, notifications, reminder time, focus strictness, how points work, and the app version. This keeps instructions out of the way.

Data notes: missions and focus results are stored in the existing `logs` collection (`kind: "mission" | "focus"`), focus status in the player document, and deleted messages are marked `deleted: true`. Older entries keep working.

---

Cost: **free** (Firebase Spark plan + free static hosting). Time: about 15 minutes.

> 🤖 Prefer to let Claude Cowork do the setup? See **COWORK_SETUP.md** — it has a ready-to-paste prompt.

---

## 1. Create a Firebase project
1. <https://console.firebase.google.com> → **Add project** (e.g. `study-duel`, Google Analytics off is fine).
2. Click the **`</>` Web** icon → register an app (don't tick "Firebase Hosting" here).
3. Keep the `firebaseConfig = { ... }` block it shows.

## 2. Paste your config
Open **`firebase-config.js`** and replace the `PASTE_...` values with yours. Save. (Leave `apkUrl` empty for now.)

## 3. Turn on two services
- **Authentication** → *Get started* → *Sign-in method* → enable **Anonymous**.
- **Firestore Database** → *Create database* → choose a location → **production mode**.
  Then open the **Rules** tab, replace everything with the contents of **`firestore.rules`**, and **Publish**.

## 4. Host it (HTTPS required — pick ONE)
- **Netlify Drop (easiest):** <https://app.netlify.com/drop> → drag the whole folder in. You get `https://something.netlify.app`.
- **Firebase Hosting:** `npm i -g firebase-tools` → `firebase login` → `firebase init hosting` (public directory `.`, don't overwrite index.html) → `firebase deploy`.
- **GitHub Pages / Cloudflare Pages / Vercel:** upload the files as a static site; no build step.

> If sign-in complains about the domain: Firebase → Authentication → Settings → **Authorized domains** → add your hosting domain.

## 5. Play
1. Open your site on your phone → **Create a party** (or **Play solo**) → pick a nickname → set up the round. You're the host 👑.
2. Go to the **Party** tab. You'll see:
   - **Invite friends:** a QR code + link. Friends scan it (phone camera) or open the link, pick a nickname, and they're in.
   - **Get the app:** a second QR code/link to install the app itself (see section 6).
   - **Make a new invite:** makes the old QR/link stop working (use it if a link leaked or after removing someone).
3. Only the host sees those QR codes and links. There is no "type a code" screen — joining needs the QR or link.

## 6. Get it as an app on phones

### Quick way — install from the browser (works now, no APK)
Open your site on the phone:
- **Android (Chrome):** tap **Install app** (banner or ⋮ menu). Android builds a real app from it (it appears in the app drawer).
- **iPhone (Safari):** Share → **Add to Home Screen**.

### Make a real APK file (Android) with PWABuilder — free
I couldn't build an APK for you because it needs Android's build tools and internet access, which I don't have.
**PWABuilder** (made by Microsoft) does it in a few clicks, and this app already meets its requirements (manifest, icons, service worker, HTTPS):
1. Go to <https://www.pwabuilder.com> → paste your site URL → **Start**. Let it finish the report.
2. **Package for stores** → **Android** → **Generate package**.
   Choose a **Package ID** like `com.yourname.studyduel`. Keep **"Create new signing key"** selected.
3. **Download**. The zip contains:
   - `*.apk` — the file you install/share on phones ✅
   - `*.aab` — only needed for Google Play
   - `signing.keystore` + `signing-key-info.txt` — **keep these safe**; you need them to publish updates later
   - `assetlinks.json` — see step 5
4. **Share the APK by link:** upload the `.apk` somewhere with a direct download link, e.g.
   a **GitHub Release**, or drop it into this folder as `study-duel.apk` and redeploy (then the link is `https://your-site/study-duel.apk`).
5. *(Recommended)* Put `assetlinks.json` at `https://your-site/.well-known/assetlinks.json` (create a `.well-known` folder in this project).
   This is what removes the browser address bar so the app looks fully native.
6. Open **`firebase-config.js`**, set `apkUrl = "https://your-site/study-duel.apk"` (your real link), and redeploy.
   The host's **Get the app** QR code now **downloads the APK**, and Android visitors get a **Download for Android** banner.
7. On a friend's phone: scan the QR / open the link → download → open the APK. Android will ask to allow **"Install unknown apps"** for the browser (a normal one-time prompt for APKs outside Google Play).

Tip: to join a party in the installed app, friends open the **invite link** (or scan the invite QR) — if the app is installed it opens there, otherwise in the browser.

---

## Good to know
- **Languages:** the first language is chosen from the phone's language. Tap **🌐** in the header to switch. Reward/punishment lists are saved in the host's language when the round starts; the host can edit them in the Party tab (any language).
- **Security (what's enforced by the database):** with `firestore.rules`, only people who joined with the party's secret invite key can read or write that party; only the host can change settings/results or remove members; players can only add/delete their own logs and messages.
  Honest caveats: someone already inside a party could technically read its invite key from the database, and chat "direct messages" are hidden in the app but not encrypted. Fine for friends.
- **If the rules ever block something unexpectedly,** paste `firestore.rules.open` into the Rules tab to get going again (it turns off the invite-only/host-only enforcement at the database level), then tell whoever helps you debug. You can test any rule in Firebase's **Rules Playground**.
- **Lost phone / cleared browser?** The app identifies you with an anonymous sign-in stored on the device. If it's lost, ask the host to remove your old entry (✕ in Party tab) and send you a new invite — your old points stay with the old entry.
- **Offline:** you can log sessions without signal; they sync when you're back online. Creating/joining a party needs internet.
- **Updating the app:** after changing any file, bump `VERSION` in `sw.js` (e.g. `studyduel-v3`) and redeploy so installed phones update. (An installed APK shows the new version automatically; no new APK needed.)
- **Free limits** (Spark plan: ~50k reads / 20k writes per day) are far more than a group of friends will use.
- **Tested:** the app logic was tested end-to-end in a headless browser against a simulated Firebase that mimics these rules (invite key, host-only, kicked-out, QR decode, Arabic/RTL). It has **not** been run against a real Firebase project, so do your first run with a friend before exam week 😉

## Files
| File | What it does |
|---|---|
| `index.html`, `app.js` | The app |
| `i18n.js` | English + Egyptian Arabic text (edit wording here) |
| `qr.js` | QR code generator (no internet needed) |
| `firebase-config.js` | Your Firebase keys + optional `apkUrl` (you edit this) |
| `firestore.rules` | Database security rules (paste into Firebase console) |
| `firestore.rules.open` | Emergency fallback rules |
| `manifest.webmanifest`, `icons/`, `screenshots/` | Make it installable / ready for PWABuilder |
| `sw.js` | Offline support |
| `firebase.json` | Only needed if you host with Firebase Hosting |
