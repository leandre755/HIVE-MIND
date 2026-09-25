# 🎭 Guide de Personnalisation de l'IA

Ce guide explique comment modifier la personnalité, le ton et le comportement de votre agent HIVE-MIND. L'identité de l'agent est centralisée dans un seul fichier : `persona.md`.

---

## 1. L'Identité de Base (`persona/persona.md`)

Ce fichier définit le nom, le rôle, et le style de langage de votre bot. Il utilise un format simple avec une en-tête (frontmatter YAML) et un corps en texte libre (Markdown).

**Emplacement :** `src/persona/persona.md`

### Structure :

```markdown
---
name: "HIVE-MIND"
role: "Assistant"
---

<language_style>
Tu communiques de manière directe, neutre et très technique. Tu évites le remplissage, la flagornerie et le méta-langage. Tu te concentres strictement sur l'exécution des tâches de manière efficace, l'analyse précise et la fourniture de réponses concises.
</language_style>
```

- **En-tête (`---`)** : Déclare les attributs formels (`name` et `role`). Respectez scrupuleusement la syntaxe `clé: "Valeur"`.
- **Corps Markdown** : Tout ce qui se trouve après le second `---` définit le style de langage dans la balise `<language_style>`. C'est ici que vous décrivez comment le bot doit s'exprimer (ton, vouvoiement/tutoiement, emojis, etc.). Ce style sera aussi utilisé automatiquement par le système lorsque l'IA doit formuler un refus d'exécuter une commande non-autorisée.

### Comment modifier :

1. Ouvrez `src/persona/persona.md`.
2. Modifiez le nom, le rôle ou le style de langage.
3. Sauvegardez le fichier. Les variables `{{AGENT_NAME}}` et `{{LANGUAGE_STYLE}}` seront automatiquement injectées dans le système.

---

## 2. Le Cerveau & Les Règles (`persona/prompts/system.md`)

Ce fichier contient le "System Prompt" complet. **Vous n'avez pas besoin de toucher à ce fichier pour changer la personnalité**. Il charge dynamiquement vos paramètres depuis `persona.md`.

**Emplacement :** `src/persona/prompts/system.md`

Toutefois, si vous souhaitez ajuster les règles métier profondes, les contraintes de sécurité ou ajouter de nouvelles compétences, c'est ici que cela se passe. Veillez simplement à ne pas supprimer les balises d'injection `{{AGENT_NAME}}` et `{{LANGUAGE_STYLE}}`.

---

## 3. Tester les changements

1. **Modifiez** le fichier `persona.md`.
2. **Redémarrez** votre bot (CTRL+C puis `npm run start`).
3. **Parlez** au bot pour vérifier qu'il a bien adopté sa nouvelle personnalité.
