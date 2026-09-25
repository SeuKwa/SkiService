# Ski Service Chartreuse

Site vitrine + back-office léger, **sans aucune dépendance** (Node.js natif).

## Démarrage

```bash
ADMIN_PASSWORD='votre-mot-de-passe' node server.js
```

- Site public : `http://localhost:3000/`
- Administration : `http://localhost:3000/admin`

Sans `ADMIN_PASSWORD`, le site public fonctionne mais la connexion admin est refusée.

## Modifier le contenu (en ligne)

1. Ouvrir `/admin` et se connecter avec le mot de passe.
2. Modifier textes, badges d'ouverture, listes de matériel, coordonnées, mentions légales.
3. Cliquer sur **Enregistrer** — le site est mis à jour immédiatement.

Le contenu est stocké dans `data/content.json`. Une sauvegarde du contenu précédent est conservée dans `data/content.backup.json` à chaque enregistrement.

## Structure

```
├── server.js              # serveur HTTP + API admin + moteur de template
├── views/
│   ├── index.html         # template du site (marqueurs {{mustache}})
│   └── admin.html         # page d'administration
├── data/
│   └── content.json       # tout le contenu éditable
├── styles.css             # design du site public
└── script.js              # menu mobile + animations
```

## Sécurité

- Connexion admin protégée par mot de passe (comparaison à temps constant, cookie `HttpOnly` + `SameSite=Strict`, session 12 h).
- Limitation : 5 tentatives de connexion par IP toutes les 10 minutes.
- Écritures atomiques (`tmp` + `rename`) avec sauvegarde automatique avant chaque modification.

## Déploiement

N'importe quel hébergeur qui exécute Node.js (Railway, Render, Fly.io, VPS…). Définir `ADMIN_PASSWORD` et `PORT` dans les variables d'environnement de l'hébergeur. Pour forcer HTTPS, placez le service derrière le reverse proxy de l'hébergeur (optionnel mais recommandé pour que le cookie de session transite chiffré).
