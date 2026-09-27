# Distribution de HIVE-MIND

## Objectif

HIVE-MIND ne doit pas obliger les utilisateurs à cloner le code source, installer TypeScript, comprendre la structure du dépôt, puis lancer manuellement le bon script. Le mode de distribution doit fournir une expérience installable, reproductible et maintenable, tout en conservant l'architecture actuelle : Core, TUI, transports, configuration locale, providers IA et auth providers OAuth.

## Contrainte particulière des auth providers

Les providers `antigravity`, `gemini-cli` et `codex` ont été ajoutés après rétro-ingénierie comportementale des harnais de ces outils. Ils imitent leurs flux d'authentification et permettent à un utilisateur d'utiliser son abonnement existant dans HIVE-MIND.

Implication directe :

- Ces providers ne doivent pas être présentés comme des intégrations officielles garanties.
- Leur activation doit être explicite côté utilisateur.
- Les secrets OAuth et fichiers d'auth locaux ne doivent jamais être empaquetés.
- Les modèles associés ne doivent pas polluer la configuration publique générale. Ils doivent rester dans un registre interne ou un module de service dédié.
- Une distribution publique doit prévoir un mécanisme de désactivation ou d'exclusion de ces providers.

## Option 1 : Paquet npm CLI

### Principe

Publier HIVE-MIND comme paquet npm avec une commande `hive-mind`.

Exemple d'usage cible :

```bash
npm install -g hive-mind
hive-mind init
hive-mind start
hive-mind tui
```

### Ce que ça implique

- Compiler le TypeScript vers `dist/`.
- Pointer `bin.hive-mind` vers un fichier JavaScript exécutable dans `dist/`, pas vers `src/bin/hive-mind.ts`.
- Inclure les fichiers de configuration par défaut dans le paquet.
- Ajouter une commande `init` qui copie les configs utilisateur dans le dossier global unifié `~/.hivemind/config/`.
- Charger les configs depuis l'ordre suivant :
  1. variables d'environnement explicites (`HIVE_CONFIG_<FILE>`, `HIVE_CONFIG_DIR`) ;
  2. dossier projet courant (`./config/` ; `models_config.json`, `pricing.json`, `scheduler.json` et `services_config.json` nécessitent `HIVE_TRUST_PROJECT_CONFIG=true` ou `1`) ;
  3. `~/.hivemind/config/` (configuration utilisateur globale) ;
  4. defaults embarqués en lecture seule (`src/config/defaults/`).

#### Emplacements des fichiers et valeurs par défaut

| Fichier de configuration | Emplacement utilisateur cible             | Template par défaut (`defaults/`)          | Comportement / Valeurs par défaut si absent                                                 | Sensibilité projet (`./config/`)                      |
| :----------------------- | :---------------------------------------- | :----------------------------------------- | :------------------------------------------------------------------------------------------ | :---------------------------------------------------- |
| `config.json`            | `~/.hivemind/config/config.json`          | `src/config/defaults/config.json`          | Protection anti-spam (10 msgs max, cooldown 2s, timeout 120s) et mode voix restreint        | Non sensible (chargé directement)                     |
| `credentials.json`       | `~/.hivemind/config/credentials.json`     | _Aucun (secrets exclus)_                   | `{}`. Si `./config/credentials.json` existe, ses clés sont fusionnées sur les clés globales | Non bloqué par opt-in (clés locales autorisées)       |
| `models_config.json`     | `~/.hivemind/config/models_config.json`   | `src/config/defaults/models_config.json`   | Catalogue exhaustif des modèles IA et routes (Gemini, Claude, GPT, Mistral, Groq...)        | **Sensible** : requiert `HIVE_TRUST_PROJECT_CONFIG=1` |
| `pricing.json`           | `~/.hivemind/config/pricing.json`         | `src/config/defaults/pricing.json`         | Fallback mémoire : $0.15/1M tokens (input), $0.60/1M tokens (output)                        | **Sensible** : requiert `HIVE_TRUST_PROJECT_CONFIG=1` |
| `scheduler.json`         | `~/.hivemind/config/scheduler.json`       | `src/config/defaults/scheduler.json`       | Cron jobs intégrés (dailyGreeting à 8h, reminderCheck à 1min, memoryCleanup à 3h)           | **Sensible** : requiert `HIVE_TRUST_PROJECT_CONFIG=1` |
| `services_config.json`   | `~/.hivemind/config/services_config.json` | `src/config/defaults/services_config.json` | Recettes standard (EXECUTOR=codestral, CRITIC=mistral-large, PLANNER=codestral)             | **Sensible** : requiert `HIVE_TRUST_PROJECT_CONFIG=1` |

#### Espaces de données et stockage local

- **Racine utilisateur (`hiveHome`)** : `~/.hivemind/` (surchargeable via `HIVE_HOME_DIR`).
- **Configurations utilisateur (`userConfigDir`)** : `~/.hivemind/config/` (surchargeable via `HIVE_CONFIG_DIR`).
- **Données et stockage persistant (`storage` / `storage_hm`)** : `~/.sandbox1/storage_hm/` (surchargeable via `STORAGE_DIR`).

### Modifications code restantes pour la distribution (#135)

- Ajouter un script de build émettant `dist/` (Node SEA / packaging).
- Configurer le champ `files` dans `package.json` pour publier `dist/`, les templates embarqués et les manifestes.
- Ajouter les commandes CLI de lifecycle (`hive-mind init`, `hive-mind doctor`).
- Déployer les scripts de connexion dédiés pour les providers OAuth (éliminant la lecture des fichiers hôte).

### Avantages

- Distribution simple pour les développeurs Node.
- Mises à jour faciles via npm.
- Compatible Linux, macOS et Windows si les chemins sont corrigés.

### Limites

- L'utilisateur doit avoir Node >= 22.
- Les dépendances natives ou lourdes restent installées via npm.
- La confidentialité des auth providers doit être documentée clairement.

## Option 2 : Binaires standalone

### Principe

Produire des exécutables `hive-mind-linux`, `hive-mind-macos`, `hive-mind-win.exe` via Node SEA, pkg, nexe ou Bun compile.

### Ce que ça implique

- Le runtime Node est embarqué ou remplacé par le runtime de l'outil.
- Les assets, prompts, configs et fichiers dynamiques doivent être accessibles hors bundle.
- Les imports dynamiques des adapters doivent être rendus compatibles avec le bundler.

### Modifications code nécessaires

- Remplacer l'auto-import dynamique basé sur `pathToFileURL(join(__dirname, 'adapters', ...))` par un registre statique d'adapters.
- Déclarer explicitement les assets à embarquer.
- Créer un dossier de données utilisateur : `~/.local/share/hive-mind/` ou équivalent XDG.
- Externaliser les caches lourds : embeddings, médias, sessions, logs.
- Ajouter une commande `doctor` pour vérifier FFmpeg, Redis, clés API, droits d'écriture et auth providers.

### Avantages

- Installation plus simple pour les utilisateurs non développeurs.
- Pas de clone du dépôt.
- Pas besoin d'installer TypeScript.

### Limites

- Les imports dynamiques actuels compliquent le packaging.
- Les modules natifs et Playwright peuvent gonfler fortement la taille.
- Chaque OS demande une CI de release dédiée.

## Option 3 : Image Docker / Docker Compose

### Principe

Distribuer HIVE-MIND sous forme d'image Docker avec un `docker-compose.yml` incluant Redis et les volumes nécessaires.

Usage cible :

```bash
docker compose up
```

### Ce que ça implique

- Construire une image Node 22.
- Monter les configs et secrets en volumes.
- Monter les dossiers d'auth providers en lecture seule si l'utilisateur les active.
- Fournir Redis dans Compose.
- Prévoir une variante TUI qui fonctionne correctement avec un terminal interactif.

### Modifications code nécessaires

- Support complet des chemins configurables par variables d'environnement.
- Aucune dépendance à `/home/omni`.
- Healthcheck HTTP ou CLI.
- Logs structurés vers stdout/stderr.
- Séparer mode daemon et mode TUI.

### Avantages

- Reproductible.
- Bon choix pour serveur personnel, VPS, NAS.
- Redis et dépendances système sont contrôlés.

### Limites

- Moins naturel pour une TUI interactive.
- Les auth providers basés sur fichiers locaux demandent des volumes bien documentés.
- WhatsApp/Baileys et QR login doivent être testés en environnement conteneurisé.

## Option 4 : Installateur Desktop/TUI

### Principe

Distribuer une application locale qui installe le Core, lance la TUI et guide la configuration des providers.

### Ce que ça implique

- Un wrapper desktop ou terminal installer.
- Gestion des mises à jour.
- Wizard de configuration pour clés API, Redis, Supabase, WhatsApp, auth providers.

### Modifications code nécessaires

- API locale stable entre UI d'installation et Core.
- Commandes `init`, `doctor`, `login-provider`, `logout-provider`.
- Stockage de secrets via keychain système quand possible.
- Éviter d'écrire les secrets dans `src/config/credentials.json`.

### Avantages

- Expérience utilisateur plus propre.
- Meilleur contrôle des erreurs de setup.
- Bon format pour HIVE-MIND si la cible n'est pas seulement développeur.

### Limites

- Plus coûteux à maintenir.
- Demande signature, packaging OS et gestion update.

## Recommandation

La meilleure trajectoire est progressive :

1. **Court terme : paquet npm CLI**  
   C'est le chemin le moins risqué. Il force déjà les bons changements : `dist/`, configs utilisateur, chemins portables, commandes `init` et `doctor`.

2. **Moyen terme : Docker Compose**  
   À ajouter pour les déploiements serveur. C'est adapté à Redis, Supabase local éventuel, logs et services persistants.

3. **Long terme : binaires standalone ou desktop installer**  
   À envisager seulement après stabilisation des imports dynamiques, des chemins de config et de la séparation daemon/TUI.

## Changements prioritaires à faire dans le code

### 1. Séparer configuration par défaut et configuration utilisateur (Réalisé — PR #138 & #139)

La résolution des configurations est désormais assurée de manière centralisée et portable par le `ConfigPathResolver` (`src/config/ConfigPathResolver.ts`). Il sépare formellement :

- Les templates embarqués par défaut en lecture seule dans `src/config/defaults/` (`config.json`, `models_config.json`, `pricing.json`, `scheduler.json`, `services_config.json`).
- La configuration utilisateur globale sanctuarisée dans `~/.hivemind/config/`.
- La configuration projet locale (`./config/`), soumise à l'opt-in de sécurité `HIVE_TRUST_PROJECT_CONFIG=1` pour les fichiers sensibles (`models_config.json`, `pricing.json`, `scheduler.json`, `services_config.json`).
- La fusion intelligente sans 401 pour `credentials.json` (les clés projet surchargent les clés globales utilisateur).

### 2. Supprimer les chemins absolus utilisateur et émanciper HIVE-MIND des fichiers hôte

Les chemins absolus codés en dur (ex: `/home/omni/...`) sont strictement proscrits au profit de `os.homedir()` et du `ConfigPathResolver`.

**Évolution architecturale majeure pour les providers OAuth :**
Dans les versions futures distribuables, HIVE-MIND **n'utilisera plus les fichiers d'authentification par défaut sur le système hôte** (comme `~/.codex/auth.json` ou les identifiants gcloud externes).
À la place, HIVE-MIND intégrera des **scripts de connexion dédiés** (ex. `hive-mind login-provider <provider>`) simulant les véritables protocoles d'autorisation OAuth (Device Authorization Grant, flux PKCE, ou boucle locale HTTP).
Ces scripts généreront et stockeront les jetons directement dans l'arborescence sanctuarisée de HIVE-MIND (`~/.hivemind/config/` ou coffre-fort sécurisé), garantissant :

- L'autonomie totale de l'application vis-à-vis des CLI tierces installées sur le système de l'opérateur.
- L'absence de régression ou de corruption mutuelle de sessions entre HIVE-MIND et d'autres logiciels hôtes.
- Une isolation parfaite pour les conteneurs et déploiements autonomes.

### 3. Introduire des commandes de lifecycle

Commandes nécessaires :

- `hive-mind init`
- `hive-mind doctor`
- `hive-mind start`
- `hive-mind tui`
- `hive-mind login-provider <provider>`
- `hive-mind logout-provider <provider>`

### 4. Rendre les auth providers optionnels

Les auth providers doivent être activés explicitement :

```json
{
  "auth_provider_bridges": {
    "codex": { "enabled": false },
    "gemini-cli": { "enabled": false },
    "antigravity": { "enabled": false }
  }
}
```

Le code doit refuser d'utiliser un auth provider désactivé même si un fichier de token existe.

### 5. Stabiliser le registre d'adapters

L'import dynamique actuel est pratique en source, mais fragile pour un binaire. Il faut un registre statique :

```text
provider id -> adapter module
```

Cela rend le bundling et les audits plus prévisibles.

### 6. Ajouter une stratégie de release

Pipeline minimal :

- `npm run build`
- `npm test`
- génération de l'artefact npm
- publication GitHub Release
- publication npm avec provenance

Pipeline Docker :

- build image multi-arch
- scan dépendances
- push vers GHCR
- publication d'un `docker-compose.yml` versionné

## Point de vigilance légal et produit

Les auth providers OAuth qui imitent Codex, Gemini CLI ou Antigravity doivent être traités comme des ponts expérimentaux. Le projet doit éviter de promettre une compatibilité durable avec des services tiers non officiels. Il faut documenter que l'utilisateur est responsable de respecter les conditions de son abonnement et que ces bridges peuvent casser si les services changent leur protocole.

## Décision proposée

Adopter d'abord une distribution npm CLI, puis ajouter Docker Compose. Ne pas commencer par un binaire standalone : le code actuel contient trop d'import dynamique, de chemins locaux et d'hypothèses de dépôt source. Ces points doivent être corrigés avant qu'un binaire soit fiable.
