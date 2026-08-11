# 🛠️ Bot Admin CLI - Documentation

Interface en ligne de commande pour administrer le bot WhatsApp.

## Installation

Aucune installation supplémentaire requise. Les commandes sont disponibles via npm.

## Usage

### Méthode Standard (npm)

```bash
npm run cli <commande> [options]
```

### Méthode Globale (hive-mind)

Une fois installé (via `npm link`), vous pouvez utiliser la commande courte `hive-mind` :

```bash
hive-mind start          # Démarrer le bot
hive-mind tools:index    # Indexer les outils
hive-mind status         # Voir l'état du système
```

---

## 🔧 Commandes DEBUG

| Commande                         | Description                              |
| -------------------------------- | ---------------------------------------- |
| `debug on`                       | Active tous les logs DEBUG               |
| `debug off`                      | Désactive les logs DEBUG                 |
| `debug status`                   | Affiche l'état actuel du debug           |
| `debug reset`                    | Réinitialise (toutes catégories actives) |
| `debug categories <cat1> <cat2>` | Active uniquement certaines catégories   |

### Catégories disponibles

- `mention` - Détection des mentions du bot
- `authority` - Vérification SuperUser/GlobalAdmin
- `social` - Contexte social et membres du groupe
- `ban` - Commandes de modération (ban, mute)
- `router` - Routage vers les providers IA
- `admin` - Actions administratives

### Exemples

```bash
# Activer uniquement les logs de mention et authority
hive-mind debug categories mention authority

# Désactiver tous les logs DEBUG
hive-mind debug off

# Voir l'état actuel
hive-mind debug status
```

---

## 🗄️ Commandes REDIS

| Commande                  | Description                             |
| ------------------------- | --------------------------------------- |
| `redis stats`             | Affiche les statistiques du cache       |
| `redis flush --yes`       | ⚠️ Efface TOUT le cache Redis           |
| `redis clear-group <jid>` | Nettoie le cache d'un groupe spécifique |

### Exemples

```bash
# Voir les statistiques
hive-mind redis stats
# Output: { groups: 5, users: 42, workingMemory: 10, total: 57 }

# Nettoyer le cache d'un groupe (force le rescan)
hive-mind redis clear-group 123456789@g.us

# ⚠️ Effacer tout le cache (confirmation requise)
hive-mind redis flush --yes
```

### Quand nettoyer le cache ?

- Après avoir modifié la structure des données
- Si les membres du groupe ne sont pas à jour
- En cas de bugs liés aux données obsolètes

---

## 👑 Commandes ADMIN

| Commande                        | Description                            |
| ------------------------------- | -------------------------------------- |
| `admin refresh`                 | Rafraîchit le cache des admins globaux |
| `admin list`                    | Liste tous les admins globaux          |
| `admin add <jid> [name] [role]` | Ajoute un admin global                 |
| `admin remove <jid>`            | Retire un admin global                 |

### Exemples

```bash
# Rafraîchir le cache (utile après avoir ajouté un admin en DB)
hive-mind admin refresh

# Ajouter un admin
hive-mind admin add 33612345678@s.whatsapp.net "Pierre" moderator

# Retirer un admin
hive-mind admin remove 33612345678@s.whatsapp.net

# Voir la liste des admins
hive-mind admin list
# Output:
#   - 22569456432@s.whatsapp.net (owner)
#   - 33612345678@s.whatsapp.net (moderator)
```

---

---

## 🛑 Commandes BASE DE DONNÉES

| Commande              | Description                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `db:reset-data --yes` | ⚠️ Vide TOUTES les tables (Actions, Memories, Facts, Groups...) **sauf** les Admins Globaux et leurs Users |

### Exemples

```bash
# Réinitialise la base pour repartir de zéro (conserve les admins)
npm run cli db:reset-data --yes
```

---

## 🛠️ Commandes OUTILS (RAG)

| Commande      | Description                                              |
| ------------- | -------------------------------------------------------- |
| `tools:index` | Indexe tous les outils/plugins dans Supabase pour le RAG |

### Exemples

```bash
# À lancer après avoir ajouté un nouveau plugin ou modifié une description
npm run cli tools:index
# Output: ✅ 15 tools indexed successfully.
```

---

## 🕵️‍♂️ Commandes DIAGNOSTIC

| Commande            | Description                                                         |
| ------------------- | ------------------------------------------------------------------- |
| `audit:group <jid>` | Audit complet : Compare Live WhatsApp vs Cache Redis vs DB Supabase |
| `debug-meta <jid>`  | _(Script direct)_ Affiche les métadonnées brutes de l'API WhatsApp  |

### Exemples

```bash
# Vérifier pourquoi un groupe ne se met pas à jour
npm run audit:group 123456789@g.us

# Vérifier si WhatsApp envoie des LIDs ou des JIDs (requiert arrêt du bot)
node scripts/debug-wa-metadata.js 123456789@g.us
```

---

## 📱 Commandes SESSION / RÉPARATION

| Commande         | Description                                                                             |
| ---------------- | --------------------------------------------------------------------------------------- |
| `npm run repair` | Nettoie le cache de session corrompu (MessageCounterError) tout en gardant l'appairage. |

### Pourquoi utiliser `repair` ?

En cas d'erreurs répétées du type `MessageCounterError` ou `Key used already`, cela signifie que le cache local de Baileys est désynchronisé.
Cette commande supprime les fichiers temporaires de session **mais conserve `creds.json`**, vous évitant ainsi de devoir rescanner le QR Code.

### Exemple

```bash
npm run repair
```

---

## 📊 Commandes SYSTÈME

| Commande | Description                       |
| -------- | --------------------------------- |
| `status` | Affiche l'état complet du système |
| `help`   | Affiche l'aide                    |

### Exemple

```bash
npm run cli status
```

Output:

```json
{
  "timestamp": "2026-01-14T21:45:00.000Z",
  "debug": {
    "enabled": true,
    "categories": ["all"],
    "verbose": false
  },
  "services": {
    "redis": "✅ OK",
    "adminCache": "3 admin(s)"
  },
  "redisStats": {
    "groups": 5,
    "users": 42,
    "workingMemory": 10,
    "total": 57
  }
}
```

---

## 🔌 Utilisation dans le code

Le logger peut aussi être utilisé directement dans le code :

```javascript
import { logger, enableDebug, disableDebug } from '../utils/logger.js';

// Logs conditionnels par catégorie
logger.debug('mention', 'Bot mentionné par', jid);
logger.debug('authority', 'SuperUser détecté:', name);

// Logs toujours affichés
logger.info('Message reçu');
logger.warn('Rate limit proche');
logger.error('Erreur:', err.message);

// Contrôle programmatique
enableDebug(); // Active les logs DEBUG
disableDebug(); // Désactive les logs DEBUG
```

-
