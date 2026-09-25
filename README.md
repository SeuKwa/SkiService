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

## Déploiement Hostinger (offre Business)

L'offre Business de Hostinger héberge les apps Node.js avec déploiement depuis GitHub :

1. hPanel → **Websites** → **Add Website** → **Deploy Web App** → **Import Git Repository**.
2. Autoriser GitHub (ou coller l'URL du dépôt public) et sélectionner `SeuKwa/SkiService`.
3. Framework : **Other** (detection automatique probable) — *Entry file* : `server.js` — pas de build requis (zéro dépendance).
4. Une fois le site créé, dans son Dashboard → **Environment Variables**, ajouter :
   - `ADMIN_PASSWORD` = votre mot de passe back-office (obligatoire)
   - `DATA_DIR` = `/home/{utilisateur}/private/skiservice-data` (recommandé)
5. Redéployer. C'est en ligne.

### Synchronisation automatique GitHub → Hostinger

Une fois le dépôt connecté, chaque `git push` sur la branche liée (`main`) redéploie le site automatiquement — aucun passage par le gestionnaire de fichiers :

- Hostinger s'intègre via une **GitHub App** (OAuth) : pendant l'installation, autorisez l'accès au dépôt `SeuKwa/SkiService` (modifiable ensuite dans GitHub → Settings → Applications).
- À chaque push, GitHub notifie Hostinger via webhook, qui tire les nouveaux fichiers, relance `npm start` et redémarre l'app.
- L'état de la connexion et l'historique des déploiements sont visibles dans hPanel → **Node.js** (onglet Deployments) ; les logs de build y sont conservés.
- Si l'accès GitHub est perdu (« Repository access missing »), cliquez **Manage access** dans hPanel ou réinstallez la GitHub App.
- Si les fichiers ne semblent pas à jour après un déploiement, vérifiez le log du déploiement puis videz le cache du site.

**Pourquoi `DATA_DIR` ?** Hostinger écrase les fichiers applicatifs à chaque déploiement (`hbuilds/`). Sans cette variable, chaque redéploiement remettrait le contenu du back-office à zéro. En pointant `DATA_DIR` vers un dossier hors des fichiers de déploiement (le dossier `private/` n'est pas accessible depuis le web et survit aux redéploiements), vos modifications faites dans /admin sont conservées. Au premier démarrage, le serveur copie `data/content.json` du dépôt vers ce dossier si absent.

## Déploiement VPS / autre

`node server.js` avec `PORT` et `ADMIN_PASSWORD` dans l'environnement suffit ; placer le service derrière un reverse proxy nginx/caddy pour HTTPS.
