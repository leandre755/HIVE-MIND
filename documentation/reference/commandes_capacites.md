# 📜 Liste des Commandes et Capacités du Bot (V1)

Ce document référence l'intégralité des commandes disponibles, qu'elles soient déclenchées par texte (Regex) ou par l'Intelligence Artificielle.

---

## 🛠️ Commandes Développeur / Système (Préfixe ".")

Ces commandes sont rapides, sans IA, et servent à la maintenance ou au debug.

| Commande      | Description                                          | Permission    |
| :------------ | :--------------------------------------------------- | :------------ |
| `.shutdown`   | 🛑 Arrête immédiatement le processus du bot.         | **Admin/Dev** |
| `.devcontact` | 📇 Envoie la fiche contact du développeur (+225...). | Tout le monde |

---

## 👥 Gestion de Groupe (Group Manager)

Commandes pour gérer les membres et la sécurité. L'IA peut les exécuter si tu lui demandes en langage naturel.

### Commandes IA (Langage Naturel)

_Exemple : "Bannis @Toto", "Mute tout le monde", "Change la description"_

| Action              | Description                               | Exemple naturel                    |
| :------------------ | :---------------------------------------- | :--------------------------------- |
| **Bannir**          | Retire un utilisateur du groupe (Ban).    | "Bannis @Jean car il spamme"       |
| **Expulser (Kick)** | Expulse sans bannir (Avertissement fort). | "Vire @Jean (Kick simple)"         |
| **Avertir (Warn)**  | Ajoute un avertissement officiel.         | "Mets un warn à @Pierre"           |
| **Verrouiller**     | Ferme le groupe (Admins only).            | "Verrouille le groupe"             |
| **Déverrouiller**   | Rouvre le groupe.                         | "Ouvre le groupe"                  |
| **Mute (Chut)**     | Empêche un membre de parler (Admin only). | "Mute @Pierre pour 10 minutes"     |
| **Unmute**          | Redonne la parole.                        | "Redonne la parole à @Pierre"      |
| **Tag All**         | Mentionne tout le monde.                  | "Tag tout le monde pour l'annonce" |
| **Promouvoir**      | Promeut un membre Admin.                  | "Mets @Alice admin"                |
| **Rétrograder**     | Retire les droits Admin.                  | "Retire les droits de @Alice"      |
| **Info Groupe**     | Affiche les infos (Dernier scan).         | "Donne-moi les infos du groupe"    |

### 💻 SYSTEM (Super-Admins)

| Action       | Description                  | Exemple                   |
| :----------- | :--------------------------- | :------------------------ |
| **Status**   | Affiche CPU/RAM/Uptime.      | "Status système" / `.sys` |
| **Shutdown** | Arrête le processus.         | "Eteins-toi" / `.stop`    |
| **Restart**  | Redémarre (si géré par PM2). | "Reboot" / `.restart`     |
| **Update**   | Git pull du code.            | "Mets-toi à jour"         |

### Commandes Textuelles (Legacy / Rapide)

_Ces commandes sont parsées via `.task` pour contourner l'IA si besoin._

| Commande       | Format                         | Description         |
| :------------- | :----------------------------- | :------------------ |
| `.task ban`    | `.task ban @user [raison]`     | Bannissement direct |
| `.task mute`   | `.task mute @user [durée_min]` | Mute temporaire     |
| `.task unmute` | `.task unmute @user`           | Unmute direct       |
| `.task tagall` | `.task tagall [message]`       | Tag tout le monde   |

---

## 🎭 Interactions & Social (Social Intelligence)

Fonctionnalités pour rendre le bot vivant et interactif.

| Fonctionnalité                | Description                                                      | Déclencheur                           |
| :---------------------------- | :--------------------------------------------------------------- | :------------------------------------ |
| **Réponse Adaptative**        | Le bot adapte son style (Citation/Tag) selon la vitesse du chat. | Automatique (Activité du groupe)      |
| **Conversation Contextuelle** | Le bot répond sans qu'on le nomme si on est seul avec lui.       | Automatique (Suivi de conversation)   |
| **Réactions Émotionnelles**   | Réagit par emoji (🤦‍♂️, 😂, ❤️) au lieu de parler.                 | Automatique (Jugement IA)             |
| **Sondages**                  | Crée un vrai sondage WhatsApp.                                   | "Lance un sondage : Pizza ou Sushi ?" |
| **Contact**                   | Envoie une fiche contact VCard.                                  | "Envoie le contact de X..."           |
| **Présence**                  | S'affiche "En ligne" ou "Écrit..."                               | Automatique                           |

---

## 🧠 Services & Mémoire

Services cognitifs pour enrichir l'expérience.

| Outil                  | Description                                   | Exemple naturel                          |
| :--------------------- | :-------------------------------------------- | :--------------------------------------- |
| **Recherche Web**      | Cherche sur DuckDuckGo (Actus, Météo, Faits). | "Qui a gagné le match ?" / "Météo Paris" |
| **Mémoire Long Terme** | Se souvient des faits passés.                 | "Qu'est-ce que je t'ai dit hier ?"       |
| **Mémoire Groupe**     | Connaît les membres et le contexte.           | "Qui est admin ici ?"                    |

---

## 🔊 Text-to-Speech (TTS)

Le plugin `text_to_speech` convertit du texte en audio. Il peut être déclenché par l'IA en langage naturel ou directement par commande texte.

### Commandes Textuelles

| Commande | Format                                | Description                                                                        |
| :------- | :------------------------------------ | :--------------------------------------------------------------------------------- |
| `.tts`   | `.tts [laughs] Bonjour tout le monde` | Utilise Gemini 3.1 Flash TTS en priorité, puis GTTS si Gemini échoue/quota épuisé. |
| `.gtts`  | `.gtts Bonjour tout le monde`         | Force GTTS simple uniquement. Les tags/voix/styles Gemini sont ignorés/nettoyés.   |

### Options IA

Quand l'outil est appelé par l'IA, il peut aussi choisir :

- `voice` : une des 30 voix Gemini (`Aoede`, `Callirrhoe`, `Charon`, `Kore`, etc.).
- `style_notes`, `tone`, `accent`, `pace`, `language`, `speaker_1`, `speaker_2` : contrôles Gemini Director Chair.
- `provider` : `auto`/`gemini` pour Gemini puis GTTS fallback, ou `gtts` pour GTTS simple.
- `send_as` : `voice_note` pour un vocal WhatsApp, ou `audio` pour envoyer directement un média audio standard.

En fallback GTTS, le plugin ne transmet pas les paramètres Gemini avancés. Il nettoie les tags inline (`[laughs]`, `[slow]`, etc.) et garde seulement le texte + la langue.

---

## 📝 Notes Techniques

- **Préfixe IA** : Aucun. Parlez naturellement "Erina, ..." ou mentionnez `@Erina`.
- **Préfixe Commande** : `.` (point) pour les commandes techniques (`.shutdown`).
- **Mode Solo** : Si vous parlez seul avec le bot, pas besoin de répéter son nom à chaque fois (pendant 2 min).

> _Dernière mise à jour : 18 Janvier 2026_
