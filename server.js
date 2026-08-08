const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// Le mot de passe se lit depuis une variable d'environnement.
// Sur Render, tu le définis dans "Environment" (jamais dans le code).
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || "changeme";

const DATA_FILE = path.join(__dirname, "data.json");

// Sessions "owner" en mémoire : token -> date d'expiration
const sessions = new Map();
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

app.use(express.json({ limit: "8mb" }));
app.use(express.static(path.join(__dirname, "public")));

function defaultData() {
  return { S: [], A: [], B: [], C: [], D: [] };
}

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch {
    return defaultData();
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function isAuthorized(req) {
  const token = req.headers["authorization"]?.replace("Bearer ", "");
  if (!token || !sessions.has(token)) return false;
  const expiry = sessions.get(token);
  if (Date.now() > expiry) {
    sessions.delete(token);
    return false;
  }
  return true;
}

// --- Routes API ---

// Récupérer la tier list actuelle (public, tout le monde peut lire)
app.get("/api/tierlist", (req, res) => {
  res.json(loadData());
});

// Connexion owner : vérifie le mot de passe côté serveur
app.post("/api/login", (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== "string" || password !== OWNER_PASSWORD) {
    return res.status(401).json({ error: "Mot de passe incorrect" });
  }
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, Date.now() + SESSION_DURATION_MS);
  res.json({ token, expiresInMs: SESSION_DURATION_MS });
});

// Vérifier si un token owner stocké côté client est toujours valide
app.get("/api/verify", (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false });
  }
  res.json({ ok: true });
});

// Sauvegarder la tier list (protégé : token owner obligatoire)
app.post("/api/tierlist", (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(403).json({ error: "Non autorisé" });
  }

  const incoming = req.body;
  const tiers = ["S", "A", "B", "C", "D"];
  const clean = defaultData();

  // Un ID Discord valide est un "snowflake" : uniquement des chiffres,
  // entre 17 et 20 caractères.
  const isValidDiscordId = (id) => /^\d{17,20}$/.test(id);

  for (const t of tiers) {
    if (Array.isArray(incoming?.[t])) {
      clean[t] = incoming[t]
        .filter(p => p && typeof p.name === "string" && p.name.trim())
        .map(p => {
          const rawImage = String(p.image || "").trim();
          // On accepte uniquement des images envoyées en base64 (upload direct),
          // avec une taille plafonnée pour ne pas surcharger le stockage.
          const isValidImage =
            /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(rawImage) &&
            rawImage.length <= 2_000_000;

          const rawDiscordId = String(p.discordId || "").trim();

          return {
            name: String(p.name).slice(0, 40),
            image: isValidImage ? rawImage : "",
            discordId: isValidDiscordId(rawDiscordId) ? rawDiscordId : ""
          };
        });
    }
  }

  saveData(clean);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Serveur lancé sur le port ${PORT}`);
  if (OWNER_PASSWORD === "changeme") {
    console.warn("⚠️  OWNER_PASSWORD n'est pas défini — mot de passe par défaut utilisé !");
  }
});
