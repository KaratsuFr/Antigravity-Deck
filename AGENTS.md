# Directives Spécifiques : Antigravity Deck (`agy-deck`)

## 1. Contexte & Architecture
- **Dépôt** : `/root/repos/agy-deck` est l'espace de développement dédié pour Antigravity Deck.
- **Référence Obligatoire** : Avant toute exploration de code ou conception, consulter [ARCHITECTURE.md](file:///root/repos/agy-deck/ARCHITECTURE.md). Il contient la cartographie complète des fichiers, les flux ConnectRPC, les règles de quotas et le modèle Hub. Ne pas relire les fichiers backend/frontend déjà documentés sauf si modification ciblée requise.
- **Service Production** : L'instance en production tourne dans `/opt/antigravity-deck` (`antigravity-deck.service`). Le dossier `/root/repos/agy-deck` est strictement réservé au dev, tests et commits.

---

## 2. Remotes Git & Branches
- **Remotes configurés** :
  - `origin` : `git@github.com:KaratsuFr/Antigravity-Deck.git` (fork utilisateur).
  - `forgejo` : `https://forgejo.lan/devbox/antigravity-deck.git` (miroir local DevBox).
  - `upstream` : `https://github.com/tysonnbt/Antigravity-Deck.git` (dépôt amont officiel).
- **Branche active** : Toujours travailler sur `patched-agy-detect-ui` (ou créer une branche de feature dérivée).
- **Pushes** : Pousser systématiquement sur `origin` et `forgejo` en cas de synchronisation.

---

## 3. Dépendances & Liens Symboliques
- `hub.json` pointe vers `/opt/antigravity-deck/hub.json` pour partager le port actif et le token CSRF du daemon local `agy`.
- `node_modules` et `frontend/node_modules` sont symlinkés vers `/opt/antigravity-deck/` pour économiser l'espace disque et accélérer les builds sans réinstallation npm superflue.

---

## 4. Règles de Développement & Validation
- **Vérification TypeScript & Build** : Toute modification frontend doit être validée par :
  ```bash
  cd /root/repos/agy-deck/frontend && npm run build
  ```
  Le build Turbopack doit impérativement se terminer avec le code 0 (`✓ Compiled successfully`).
- **Détection Hub** : Tout changement touchant à la détection du Language Server (`scripts/discover-hub.py` ou `src/detector.js`) doit s'exécuter sous 0.5s et ne jamais saturer le CPU en itérations exhaustives sur le heap Go.
- **Quotas & Protobuf** :
  - Traiter la valeur `0.0` comme un quota épuisé (`remainingFraction: 0` est omis par protobuf).
  - Vérifier systématiquement `RetrieveUserQuotaSummary` pour respecter les groupes (`Gemini Models`, `Claude and GPT models`, `Gemini 4 Argon`).

---

## 5. Déploiement en Production
1. Valider et committer les changements dans `/root/repos/agy-deck`.
2. Synchroniser vers `/opt/antigravity-deck` :
   ```bash
   cd /opt/antigravity-deck && git pull origin patched-agy-detect-ui
   cd /opt/antigravity-deck/frontend && npm run build
   ```
3. **Confirmation humaine obligatoire** avant toute relance de service :
   ```bash
   systemctl restart antigravity-deck.service
   ```
