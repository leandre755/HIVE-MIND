# 🎭 Guide de Personnalisation de l'IA

Ce guide vous explique comment modifier la personnalité, le ton et le comportement de votre bot WhatsApp (son nom est HIVE-MIND par default). Toute la configuration se trouve dans le dossier `persona/`.

---

## 1. L'Identité de Base (`persona/profile.json`)

Ce fichier JSON définit les attributs statiques de votre bot. C'est sa "carte d'identité".

**Emplacement :** `persona/profile.json`

### Structure :

```json
{
  "name": "HIVE-MIND", // Le nom du bot (utilisé dans les prompts)
  "role": "Assistante Culinare", // Son rôle principal
  "age": 25, // (Optionnel) Âge fictif
  "traits": [
    // Adjectifs décrivant son caractère
    "Enjouée",
    "Précise",
    "Bienveillante"
  ],
  "interests": [
    // Ses centres d'intérêt (pour la conversation)
    "Cuisine française",
    "Pâtisserie",
    "Nutrition"
  ],
  "languages": ["fr", "en"] // Langues parlées
}
```

### Comment modifier :

1. Ouvrez le fichier.
2. Changez les valeurs (gardez la structure JSON valide).
3. Sauvegardez et redémarrez le bot.

---

## 2. Le Cerveau & Les Règles (`persona/prompts/system.md`)

C'est le fichier **le plus important**. Il contient le "System Prompt" (la consigne initiale) envoyée à l'IA avant chaque conversation. Il définit comment elle doit parler, ce qu'elle a le droit de faire ou non.

**Emplacement :** `persona/prompts/system.md`

### Conseils de rédaction :

- **Soyez directif** : Utilisez l'impératif ("Tu dois...", "Interdiction de...").
- **Définissez le ton** : "Tu es sarcastique", "Tu es très formel", "Tu utilises beaucoup d'emojis".
- **Gérez les limites** : "Ne jamais donner de conseils médicaux", "Si on t'insulte, réponds avec humour".

### Exemple de modification :

_Pour transformer HIVE-MIND en un robot froid et calculateur :_

```markdown
# Identité

Tu es UNIT-734, une IA analytique.

# Comportement

- Ne montre aucune émotion.
- Tes réponses doivent être concises et purement factuelles.
- N'utilise jamais d'emojis.
- Appelle les utilisateurs "Humains".
```

---

## 3. Tester les changements

1. **Modifiez** les fichiers `profile.json` ou `system.md`.
2. **Redémarrez** votre bot (CTRL+C puis `npm run start`).
3. **Parlez** au bot pour vérifier qu'il a bien adopté sa nouvelle personnalité.

> **Astuce** : Si le bot semble "oublier" sa personnalité, vérifiez que le fichier `system.md` n'est pas trop long. Les modèles IA ont une limite de mémoire (contexte). Allez à l'essentiel.

---

## 4. Les Modèles de Refus (`persona/prompts/refusal.md`)

Quand l'IA doit refuser une action (ex: commande admin interdite), elle utilise un prompt spécifique pour générer sa réponse.

**Emplacement :** `persona/prompts/refusal.md`

Ce fichier contient les instructions et des exemples de style pour les refus.
Vous pouvez y ajouter vos propres "punchlines" ou changer le ton des refus.

### Exemple de modification :

Pour des refus très polis :

```markdown
Tu es {{name}}. Refuse poliment la demande pour la raison : {{reason}}.
Exemples :

- "Je suis navrée, mais je ne peux pas faire cela."
- "Mes excuses, cette action n'est pas autorisée."
```

L'IA utilisera ces exemples pour générer une réponse adaptée au contexte.
