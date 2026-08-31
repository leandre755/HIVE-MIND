# Execution Plan: Synchronisation et Sauvegarde des Sessions TUI sur Supabase (Session 16)

## 📋 Target Invariant & Pre-requisites
- **Target Invariant**: Les fichiers locaux JSON/JSONL dans le répertoire `.hive-mind/temp/<hash>/chats/` (préfixe `hive_session_`) doivent rester la source de vérité absolue pour l'historique et la reprise des sessions de la TUI locale. Chaque nouveau tour de conversation (message utilisateur et réponse assistant) doit être écrit localement ET synchronisé/sauvegardé de manière asynchrone sur la table `memories` de Supabase sous un `context_id` unique correspondant à l'identifiant de la session de la TUI. Si Supabase est hors-ligne, la TUI doit continuer de fonctionner normalement avec son stockage local.
- **Pre-requisites**: Client Supabase configuré dans `src/services/supabase.ts` et service de mémoire sémantique dans `src/services/memory.ts`.

## 🛠️ Step-by-Step Sequence

### Step 1: Implémenter l'écriture locale des sessions TUI
- [ ] **Action**:
  - Activer et implémenter le service d'enregistrement des sessions locales (`ChatRecordingService` ou équivalent) dans la TUI.
  - Lorsqu'un message (utilisateur ou assistant) est envoyé ou reçu, écrire l'historique dans un fichier local de format `hive_session_<session-id>.json` sous le répertoire des chats locaux.
- [ ] **Verify**: `npx tsc --noEmit && npx eslint src/tui/`
- **Verification Proof**:
```text
```

### Step 2: Utiliser un identifiant de session unique pour le Core
- [ ] **Action**:
  - Dans `src/tui/core/connection.ts`, modifier la méthode `send` pour transmettre `hiveConfig.getSessionId()` (qui est unique pour chaque session) en tant que `chatId` au core, au lieu d'utiliser le jeton statique `'tui-local'`.
  - Cela permettra au Core d'enregistrer naturellement les mémoires de cette session sous le bon `context_id` dans Supabase via `semanticMemory.store`.
- [ ] **Verify**: `npx tsc --noEmit`
- **Verification Proof**:
```text
```

### Step 3: Assurer la sauvegarde / synchronisation vers Supabase
- [ ] **Action**:
  - Dans le flux d'enregistrement, s'assurer que pour chaque message écrit dans le fichier local, un appel à `semanticMemory.store` est effectué avec le `sessionId` unique comme `chatId` afin de sauvegarder le message dans la table `memories` de Supabase.
  - Gérer gracieusement les échecs de connexion à Supabase en loggant un warning sans bloquer l'écriture locale.
- [ ] **Verify**: Compilation réussie et vérification des logs.
- **Verification Proof**:
```text
```

### Step 4: Valider le bon fonctionnement du SessionBrowser local
- [ ] **Action**:
  - Vérifier que `SessionBrowser` et la commande `/session list` de la TUI continuent de lister les sessions à partir de la source de vérité (les fichiers locaux) et permettent de recharger une session avec tout son historique.
- [ ] **Verify**: Lancement de la TUI, vérification de l'écriture des fichiers locaux et de la présence des correspondances dans Supabase.
- **Verification Proof**:
```text
```

## ⚠️ Mitigations & Edge Cases
- **Risk**: Blocage ou ralentissement de la TUI locale en cas de latence lors de la sauvegarde sur Supabase.
- **Mitigation**: Exécuter la synchronisation vers Supabase de façon asynchrone sans attendre la résolution de la promesse (fire-and-forget supervisé avec gestion interne des erreurs) pour préserver la réactivité de la TUI.
