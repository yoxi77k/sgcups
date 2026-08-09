const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

// ---------------------------------------------------------------------------
// Configuration (all overridable with Render environment variables)
// ---------------------------------------------------------------------------
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || 'Ashgoat';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-please-in-render-env-vars';
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
// Must exactly match one of the "Redirects" configured in the Discord
// Developer Portal, e.g. https://your-app.onrender.com/auth/discord/callback
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || '';

app.set('trust proxy', 1); // needed on Render so secure cookies work behind its proxy
app.use(express.json({ limit: '5mb' }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 30 // 30 days
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch (err) {
    const fresh = { players: [], bracketGenerated: false, rounds: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function requireOwner(req, res, next) {
  if (!req.session.isOwner) {
    return res.status(401).json({ error: 'Not authorized' });
  }
  next();
}

function requireDiscord(req, res, next) {
  if (!req.session.discordUser) {
    return res.status(401).json({ error: 'You must log in with Discord first.' });
  }
  next();
}

function roundName(index, totalRounds) {
  const fromEnd = totalRounds - index;
  if (fromEnd === 1) return 'Final';
  if (fromEnd === 2) return 'Semifinals';
  if (fromEnd === 3) return 'Quarterfinals';
  if (fromEnd === 4) return 'Round of 16';
  return `Round ${index + 1}`;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeMatchId() {
  return crypto.randomBytes(4).toString('hex');
}

function buildRounds(players) {
  const shuffled = shuffle(players);
  const totalRounds = Math.log2(shuffled.length);
  const rounds = [];

  const firstRound = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    firstRound.push({
      id: makeMatchId(),
      player1: shuffled[i],
      player2: shuffled[i + 1],
      winner: null,
      reportedWinner: null,
      confirmations: {},
      status: 'pending'
    });
  }
  rounds.push({ name: roundName(0, totalRounds), matches: firstRound });

  let previousCount = firstRound.length;
  for (let r = 1; r < totalRounds; r++) {
    const matches = [];
    for (let i = 0; i < previousCount / 2; i++) {
      matches.push({
        id: makeMatchId(),
        player1: null,
        player2: null,
        winner: null,
        reportedWinner: null,
        confirmations: {},
        status: 'waiting'
      });
    }
    rounds.push({ name: roundName(r, totalRounds), matches });
    previousCount = matches.length;
  }

  return rounds;
}

function findMatch(rounds, matchId) {
  for (let r = 0; r < rounds.length; r++) {
    const idx = rounds[r].matches.findIndex((m) => m.id === matchId);
    if (idx !== -1) return { roundIndex: r, matchIndex: idx, match: rounds[r].matches[idx] };
  }
  return null;
}

function advanceWinner(rounds, roundIndex, matchIndex, winner) {
  if (roundIndex + 1 >= rounds.length) return; // this was the final
  const nextMatchIndex = Math.floor(matchIndex / 2);
  const nextMatch = rounds[roundIndex + 1].matches[nextMatchIndex];
  if (matchIndex % 2 === 0) {
    nextMatch.player1 = winner;
  } else {
    nextMatch.player2 = winner;
  }
  if (nextMatch.player1 && nextMatch.player2) {
    nextMatch.status = 'pending';
  }
}

function discordAvatarUrl(discordUser) {
  if (!discordUser) return '';
  if (discordUser.avatar) {
    return `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png?size=128`;
  }
  return `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(discordUser.id) % 5n)}.png`;
}

// ---------------------------------------------------------------------------
// Discord OAuth2 routes
// ---------------------------------------------------------------------------

app.get('/auth/discord', (req, res) => {
  if (!DISCORD_CLIENT_ID || !DISCORD_REDIRECT_URI) {
    return res.status(500).send('Discord login is not configured yet. Set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET and DISCORD_REDIRECT_URI in the environment variables.');
  }
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify'
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
});

app.get('/auth/discord/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/?discord_error=missing_code');

  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: DISCORD_REDIRECT_URI
      })
    });

    if (!tokenRes.ok) throw new Error('Token exchange failed');
    const tokenData = await tokenRes.json();

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    if (!userRes.ok) throw new Error('Fetching Discord profile failed');
    const discordProfile = await userRes.json();

    req.session.discordUser = {
      id: discordProfile.id,
      username: discordProfile.username,
      avatar: discordProfile.avatar
    };

    res.redirect('/');
  } catch (err) {
    console.error('Discord OAuth error:', err);
    res.redirect('/?discord_error=login_failed');
  }
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/api/session', (req, res) => {
  const discordUser = req.session.discordUser || null;
  res.json({
    discordUser: discordUser ? {
      id: discordUser.id,
      username: discordUser.username,
      avatarUrl: discordAvatarUrl(discordUser)
    } : null,
    isOwner: !!req.session.isOwner,
    discordConfigured: !!(DISCORD_CLIENT_ID && DISCORD_REDIRECT_URI)
  });
});

// ---------------------------------------------------------------------------
// Public / player routes
// ---------------------------------------------------------------------------

app.get('/api/state', (req, res) => {
  res.json(readData());
});

app.post('/api/register', requireDiscord, (req, res) => {
  const data = readData();
  if (data.bracketGenerated) {
    return res.status(400).json({ error: 'Registrations are closed, the bracket has already been generated.' });
  }

  const discordUser = req.session.discordUser;
  const alreadyRegistered = data.players.some((p) => p.discordId === discordUser.id);
  if (alreadyRegistered) {
    return res.status(400).json({ error: 'You are already registered.' });
  }

  const { name } = req.body || {};
  const displayName = (name && name.trim()) ? name.trim().slice(0, 30) : discordUser.username;

  const player = {
    id: crypto.randomBytes(5).toString('hex'),
    name: displayName,
    image: discordAvatarUrl(discordUser),
    discordId: discordUser.id,
    discordUsername: discordUser.username
  };
  data.players.push(player);
  writeData(data);
  res.json(player);
});

app.post('/api/report-result', requireDiscord, (req, res) => {
  const data = readData();
  const { matchId, winnerId } = req.body || {};
  const found = findMatch(data.rounds, matchId);
  if (!found) return res.status(404).json({ error: 'Match not found.' });
  const { match } = found;
  if (!match.player1 || !match.player2) {
    return res.status(400).json({ error: 'This match is not ready yet.' });
  }
  if (winnerId !== match.player1.id && winnerId !== match.player2.id) {
    return res.status(400).json({ error: 'Invalid winner.' });
  }

  const discordId = req.session.discordUser.id;
  const isParticipant = match.player1.discordId === discordId || match.player2.discordId === discordId;
  if (!isParticipant && !req.session.isOwner) {
    return res.status(403).json({ error: 'Only the two players in this match (or the owner) can report a result.' });
  }

  match.reportedWinner = winnerId;
  match.confirmations = {};
  match.status = 'awaiting-confirmation';
  writeData(data);
  res.json(match);
});

app.post('/api/confirm-result', requireDiscord, (req, res) => {
  const data = readData();
  const { matchId } = req.body || {};
  const found = findMatch(data.rounds, matchId);
  if (!found) return res.status(404).json({ error: 'Match not found.' });
  const { roundIndex, matchIndex, match } = found;

  if (!match.reportedWinner) {
    return res.status(400).json({ error: 'No result has been reported for this match yet.' });
  }

  const discordId = req.session.discordUser.id;
  let playerId = null;
  if (match.player1.discordId === discordId) playerId = match.player1.id;
  if (match.player2.discordId === discordId) playerId = match.player2.id;

  if (!playerId) {
    return res.status(403).json({ error: 'You are not one of the two players in this match.' });
  }

  match.confirmations[playerId] = true;

  const bothConfirmed = match.confirmations[match.player1.id] && match.confirmations[match.player2.id];
  if (bothConfirmed) {
    const winner = match.player1.id === match.reportedWinner ? match.player1 : match.player2;
    match.winner = winner;
    match.status = 'confirmed';
    advanceWinner(data.rounds, roundIndex, matchIndex, winner);
  }

  writeData(data);
  res.json(match);
});

// ---------------------------------------------------------------------------
// Owner-only routes
// ---------------------------------------------------------------------------

// Owner login requires an active Discord session first.
app.post('/api/owner/login', requireDiscord, (req, res) => {
  const { password } = req.body || {};
  if (password !== OWNER_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  req.session.isOwner = true;
  res.json({ ok: true });
});

app.post('/api/owner/logout', (req, res) => {
  req.session.isOwner = false;
  res.json({ ok: true });
});

app.post('/api/owner/delete-player', requireOwner, (req, res) => {
  const data = readData();
  const { playerId } = req.body || {};
  data.players = data.players.filter((p) => p.id !== playerId);

  if (data.bracketGenerated) {
    data.rounds.forEach((round) => {
      round.matches.forEach((match) => {
        ['player1', 'player2'].forEach((slot) => {
          if (match[slot] && match[slot].id === playerId) {
            match[slot] = null;
            match.winner = null;
            match.reportedWinner = null;
            match.confirmations = {};
            match.status = 'waiting';
          }
        });
      });
    });
  }

  writeData(data);
  res.json({ ok: true });
});

app.post('/api/owner/generate-bracket', requireOwner, (req, res) => {
  const data = readData();
  const n = data.players.length;
  const isPowerOfTwo = n >= 2 && (n & (n - 1)) === 0;
  if (!isPowerOfTwo) {
    return res.status(400).json({ error: 'The number of players must be a power of two (2, 4, 8, 16...) to generate a bracket.' });
  }
  data.rounds = buildRounds(data.players);
  data.bracketGenerated = true;
  writeData(data);
  res.json(data);
});

app.post('/api/owner/set-result', requireOwner, (req, res) => {
  const data = readData();
  const { matchId, winnerId } = req.body || {};
  const found = findMatch(data.rounds, matchId);
  if (!found) return res.status(404).json({ error: 'Match not found.' });
  const { roundIndex, matchIndex, match } = found;
  if (!match.player1 || !match.player2) {
    return res.status(400).json({ error: 'This match is not ready yet.' });
  }
  let winner = null;
  if (match.player1.id === winnerId) winner = match.player1;
  if (match.player2.id === winnerId) winner = match.player2;
  if (!winner) return res.status(400).json({ error: 'Invalid winner.' });

  match.winner = winner;
  match.reportedWinner = winnerId;
  match.confirmations = { [match.player1.id]: true, [match.player2.id]: true };
  match.status = 'confirmed';
  advanceWinner(data.rounds, roundIndex, matchIndex, winner);

  writeData(data);
  res.json(match);
});

app.post('/api/owner/reset-bracket', requireOwner, (req, res) => {
  const data = readData();
  data.rounds = [];
  data.bracketGenerated = false;
  writeData(data);
  res.json(data);
});

app.post('/api/owner/reset-all', requireOwner, (req, res) => {
  const data = { players: [], bracketGenerated: false, rounds: [] };
  writeData(data);
  res.json(data);
});

app.listen(PORT, () => {
  console.log(`Tournament bracket server running on port ${PORT}`);
});
