# Comment Connecter un Client Terminal Autonome (TUI) au Démon HIVE-MIND via le Pont IPC WebSocket

Ce guide pratique détaille la séquence exacte pour établir une connexion WebSocket sécurisée entre un client terminal autonome (ex. `HIVE-MIND-TUI` ou un script de test) et le démon HIVE-MIND en exploitant `tui-connection.json`.

---

## Prérequis

- Node.js >= 22 (ESM natif).
- Démon HIVE-MIND en cours d'exécution avec le transport TUI activé (`ACTIVE_TRANSPORT=tui`).
- Bibliothèque `ws` installée (`npm install ws`).

---

## Étapes de Réalisation

### 1. Lire les Paramètres de Connexion (`tui-connection.json`)

Le démon génère automatiquement le fichier `tui-connection.json` dans son répertoire de travail. Chargez et parsez ce fichier pour récupérer le port d'écoute et le jeton d'authentification :

```typescript
// clientTui.ts
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import WebSocket from 'ws';

const configPath = resolve(process.cwd(), 'tui-connection.json');

if (!existsSync(configPath)) {
  throw new Error('Le fichier tui-connection.json est introuvable. Le démon HIVE-MIND est-il démarré ?');
}

const config = JSON.parse(readFileSync(configPath, 'utf-8')) as {
  host: string;
  port: number;
  token: string;
};

console.log(`Connexion ciblée vers ws://${config.host}:${config.port}...`);
```

---

### 2. Établir la Connexion WebSocket et Effectuer le Handshake d'Authentification

Connectez-vous au serveur et transmettez immédiatement la trame `auth` dans le délai imparti de 3 000 ms :

```typescript
const ws = new WebSocket(`ws://${config.host}:${config.port}`);

ws.on('open', () => {
  console.log('Socket ouverte. Envoi du token d\'authentification...');
  ws.send(
    JSON.stringify({
      type: 'auth',
      token: config.token,
    })
  );
});
```

---

### 3. Écouter les Événements Diffusés par le Démon

Traitez les messages entrants, les événements de présence et les requêtes de confirmation HITL :

```typescript
ws.on('message', (raw: WebSocket.RawData) => {
  const payload = JSON.parse(raw.toString()) as { type: string; data?: any; connected?: boolean };

  switch (payload.type) {
    case 'auth_success':
      console.log('✅ Authentification réussie auprès du démon HIVE-MIND.');
      break;

    case 'connection_status':
      console.log(`État du transport : ${payload.connected ? 'Connecté' : 'Déconnecté'}`);
      break;

    case 'message':
      console.log(`\n[Assistant] ${payload.data.text}`);
      break;

    case 'presence':
      console.log(`[Présence] ${payload.data.presence}...`);
      break;

    case 'confirmation_request':
      handleHitlConfirmation(payload.data);
      break;

    default:
      console.log(`Événement reçu : ${payload.type}`, payload.data);
  }
});

function handleHitlConfirmation(req: { id: string; type: string; description: string; data: unknown }) {
  console.log(`\n⚠️ DEMANDE D'APPROBATION HITL : ${req.description}`);
  console.log(`Type : ${req.type}`, req.data);

  // Exemple : approbation automatique dans ce script client
  const response = {
    type: 'confirmation_response',
    id: req.id,
    approved: true,
    feedback: 'Approuvé par le client terminal',
  };

  ws.send(JSON.stringify(response));
  console.log('Réponse d\'approbation transmise au démon.');
}
```

---

### 4. Soumettre un Message Utilisateur vers le Démon

Pour injecter une commande ou un texte dans le moteur ReAct de l'agent :

```typescript
export function sendUserMessage(text: string): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: 'user_message',
        text,
        options: {
          sender: 'admin@tui',
          senderName: 'Opérateur TUI',
        },
      })
    );
  }
}
```

---

## Cas Particuliers & Variantes

### Variante A : Client de Test E2E Automatisé avec Déconnexion Propre

Pour valider le cycle complet dans une suite de tests automatisée :

```typescript
export async function runE2ETestSequence(port: number, token: string): Promise<void> {
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  await new Promise<void>((resolve, reject) => {
    client.on('open', () => {
      client.send(JSON.stringify({ type: 'auth', token }));
    });
    client.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'auth_success') resolve();
    });
    client.on('error', reject);
  });

  client.close();
}
```

---

## Vérification & Validation

Validez le fonctionnement du pont IPC et des flux WebSocket via les suites de tests d'intégration et de stress du projet :

```bash
npx jest src/tests/integration/tui_websocket.test.ts src/tests/unit/transport/hiveTransport_empirical_challenge.test.ts --runInBand
```

Résultat attendu dans le terminal :
```text
PASS src/tests/integration/tui_websocket.test.ts
PASS src/tests/unit/transport/hiveTransport_empirical_challenge.test.ts

Test Suites: 2 passed, 2 total
Tests:       12 passed, 12 total
Snapshots:   0 total
Time:        ...s
Ran all test suites matching /tui_websocket|hiveTransport_empirical_challenge/i.
```

---

## Guide de Dépannage (Troubleshooting)

| Symptôme / Message d'Erreur | Cause Probable | Solution Immédiate |
| :--- | :--- | :--- |
| `WebSocket close code 4401: Unauthorized timeout` | Le client n'a pas envoyé la trame `{"type":"auth","token":"..."}` dans les 3 secondes suivant l'ouverture du socket. | Transmettre la trame d'authentification immédiatement dans le callback `on('open')`. |
| `WebSocket close code 4403: Invalid token` | Le jeton transmis ne correspond pas à celui de `tui-connection.json` (redémarrage du démon ayant régénéré un UUID). | Recharger systématiquement `tui-connection.json` avant chaque tentative de connexion. |
| `ECONNREFUSED 127.0.0.1:5001` | Le serveur `TuiServerTransport` n'est pas actif ou a été déplacé sur un autre port libre (ex. 5002) suite à une collision. | Lire la propriété `port` effective dans `tui-connection.json` plutôt que de cibler le port 5001 en dur. |
