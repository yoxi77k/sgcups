# Stumble Cups — Tier List

Tier list avec zone "Owner" protégée. Le mot de passe est vérifié **côté serveur**
(dans `server.js`), il n'apparaît nulle part dans le code envoyé au navigateur.

## Structure

```
stumble-cups/
├── server.js          # backend Express (login + sauvegarde)
├── package.json
├── data.json           # stockage de la tier list (créé/modifié automatiquement)
└── public/
    └── index.html       # front-end (HTML + CSS + JS)
```

## Tester en local

```bash
npm install
OWNER_PASSWORD=ton_mot_de_passe npm start
```

Puis ouvre http://localhost:3000

## Déployer sur Render

1. **Mets ce dossier sur GitHub**
   - Crée un repo (public ou privé).
   - Pousse tous ces fichiers dedans (sauf `node_modules`, déjà ignoré par `.gitignore`).

2. **Crée un "Web Service" sur Render** (pas un "Static Site", car il y a un serveur)
   - Dashboard Render → **New** → **Web Service**
   - Connecte ton repo GitHub.

3. **Configuration**
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Environment** : Node

4. **Variable d'environnement (important !)**
   - Dans l'onglet **Environment** du service Render, ajoute :
     - Clé : `OWNER_PASSWORD`
     - Valeur : ton mot de passe secret (choisis-en un nouveau, ne réutilise pas `yoxi77`)
   - Ça évite d'avoir le mot de passe écrit dans le code / sur GitHub.

5. **Déployer**
   - Clique sur **Create Web Service**.
   - Render te donne une URL du type `https://ton-nom.onrender.com`.

## ⚠️ Limite à connaître

Sur le plan gratuit de Render, le disque n'est **pas persistant** : si le service
redémarre ou redéploie, `data.json` repart à zéro. Pour une tier list qui doit durer
dans le temps, il faudrait brancher une vraie base de données (ex: Render Postgres,
gratuit aussi en petit volume). Dis-moi si tu veux que je fasse cette étape.
