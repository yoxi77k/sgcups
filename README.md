# Stumble Cups Asia/India • Tournament Bracket

A Node.js/Express app that runs a community tournament bracket, styled like
the tier list site: **Discord login required to register**, an
auto-generated bracket (Quarterfinals → Semifinals → Final), result
reporting with **double confirmation** tied to each player's real Discord
account, and an **Owner Panel** (Discord login required first, then a
password) for managing everything.

## What this is (and isn't)

This uses **Discord OAuth2 "Login with Discord"**, the same kind of button
you see on many websites ("Continue with Discord"). It is **not** a bot that
joins a Discord server or runs slash commands — nobody needs to invite
anything anywhere. You just create one Discord "Application" in the
Developer Portal to get a Client ID/Secret that lets your website ask
Discord "who is this person logging in?".

## How it works

- A visitor clicks **Login with Discord**, authorizes your app, and comes
  back logged in with their real Discord username and avatar.
- Once logged in, they can register for the tournament (one registration per
  Discord account).
- The owner must **also log in with Discord first**, then click "Owner
  Area" and enter the owner password to unlock admin controls. The password
  alone is not enough — someone needs a Discord account recognized by the
  login flow before the password field is even reachable.
- When the owner generates the bracket, players are randomly seeded into
  rounds (Quarterfinals / Semifinals / Final, or Round of 16 for 16
  players).
- After a match, either of the two real players (identified by their
  Discord account, not just anyone) clicks the button for who won. This
  creates a pending result.
- Only the two Discord accounts that are actually in that match can confirm
  it — the button literally checks who you're logged in as. Once both
  confirm, the match closes and the winner advances automatically.
- The owner can, at any time: delete a player, force-set a match result
  (bypassing confirmations), reset only the bracket (keeping players), or
  reset everything.

## Files

- `public/index.html` — the whole front-end (HTML + CSS + JS), single file.
- `server.js` — Express server, session handling, Discord OAuth routes, and
  all the tournament API routes.
- `data.json` — where players and the bracket state are stored.
- `package.json` — dependencies (`express`, `express-session`) and the start
  script.

## Step 1: Create the Discord Application (for login, not a bot)

1. Go to https://discord.com/developers/applications and log in with your
   Discord account.
2. Click **New Application**, give it a name (e.g. "Stumble Cups Asia/India"),
   accept the terms, and click **Create**.
3. In the left sidebar, click **OAuth2 → General**.
4. Copy the **Client ID** — you'll need it soon.
5. Click **Reset Secret** (or it may already show one) and copy the
   **Client Secret**. Keep this private, never put it in your code or share
   it publicly.
6. Still on the OAuth2 page, under **Redirects**, click **Add Redirect** and
   enter:
   ```
   https://YOUR-RENDER-URL.onrender.com/auth/discord/callback
   ```
   Replace `YOUR-RENDER-URL` with your actual Render subdomain (you'll know
   it once you've created the Render service in Step 3 below — you can come
   back and add this after). Click **Save Changes**.

That's it — no bot token, no "Add to Server" button needed. This app only
uses the **identify** scope, meaning it only asks for the person's Discord
username and avatar, nothing else.

## Step 2: Push the files to GitHub

Same as before — one folder with this structure:
```
stumble-cups-tournament/
├── public/
│   └── index.html
├── README.md
├── data.json
├── package.json
└── server.js
```
Then either:
```bash
git init
git add .
git commit -m "Add Discord login"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/stumble-cups-tournament.git
git push -u origin main
```
or upload the files directly through GitHub's **Add file → Upload files**.

## Step 3: Create the Render Web Service

1. Go to https://render.com, sign in (ideally with GitHub).
2. **New +** → **Web Service** → connect your repository.
3. Configure:
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free (to start)

Don't click Create yet — set the environment variables first (Step 4), or
add them right after and Render will redeploy automatically.

## Step 4: Environment variables

On the Render service page, go to the **Environment** tab and add:

| Key                     | Value                                                              |
|--------------------------|---------------------------------------------------------------------|
| `OWNER_PASSWORD`         | `Ashgoat` (or your own password, case-sensitive)                    |
| `DISCORD_CLIENT_ID`      | the Client ID from Step 1                                          |
| `DISCORD_CLIENT_SECRET`  | the Client Secret from Step 1                                      |
| `DISCORD_REDIRECT_URI`   | `https://YOUR-RENDER-URL.onrender.com/auth/discord/callback`       |
| `SESSION_SECRET`         | any long random string (mash your keyboard, 20+ characters)        |
| `NODE_ENV`               | `production`                                                       |

Once you know your actual Render URL (it's shown at the top of the service
page, e.g. `stumble-cups-tournament.onrender.com`), make sure:
- `DISCORD_REDIRECT_URI` here matches it exactly, **and**
- the same URL is added under **Redirects** in the Discord Developer Portal
  (Step 1.6) — both must match exactly, including `https://` and the
  `/auth/discord/callback` path, or Discord will refuse the login.

## Step 5: Deploy

Click **Create Web Service** (or **Manual Deploy** if you already created
it). Once it's live, open your URL and try **Login with Discord** — you
should be redirected to Discord, asked to authorize, and sent back logged
in.

## Updating the site later

```bash
git add .
git commit -m "describe your change"
git push
```
Render redeploys automatically on every push to `main`.

## Notes and limitations

- Sessions are stored in memory on the server. On Render's Free plan the
  server can restart/sleep after inactivity, which will log everyone out —
  fine for a casual event, not for a "stay logged in forever" experience.
- `data.json` is also not guaranteed to persist across redeploys on the Free
  plan. For a single event this is not an issue; for long-term data, look
  into Render's persistent disks or a small database later on.
- Only the **identify** Discord scope is requested — this app never sees
  emails, servers, or messages, only public username + avatar.
- One registration per Discord account is enforced automatically.
