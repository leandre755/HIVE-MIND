import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';

type Recipe = {
  readonly primary?: string;
  readonly model?: string;
  readonly fallback?: string;
};

type ModelsConfig = {
  readonly reglages_generaux: {
    readonly service_recipes: Record<string, Recipe>;
    readonly chat_recipes: {
      readonly categories: Record<string, Recipe>;
    };
  };
};

const disallowedSmallChatModels = new Set<string>([]);

const readModelsConfig = (): ModelsConfig => {
  const rawConfig = readFileSync('src/config/models_config.json', 'utf-8');
  return JSON.parse(rawConfig) as ModelsConfig;
};

describe('Models Config Policy', () => {
  describe('chat and service model recipes', () => {
    it('should avoid small chat models except when tagging users', () => {
      // Arrange
      const modelsConfig = readModelsConfig();
      const serviceEntries = Object.entries(modelsConfig.reglages_generaux.service_recipes)
        .filter(([serviceName]) => serviceName !== 'TAG_SERVICE')
        .flatMap(([serviceName, recipe]) => [
          [`service_recipes.${serviceName}.model`, recipe.model],
          [`service_recipes.${serviceName}.fallback`, recipe.fallback],
        ]);
      const chatEntries = Object.entries(
        modelsConfig.reglages_generaux.chat_recipes.categories,
      ).flatMap(([categoryName, recipe]) => [
        [`chat_recipes.categories.${categoryName}.primary`, recipe.primary],
        [`chat_recipes.categories.${categoryName}.fallback`, recipe.fallback],
      ]);

      // Act
      const violations = [...serviceEntries, ...chatEntries]
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .filter(([, model]) => disallowedSmallChatModels.has(model));

      // Assert
      expect(violations).toEqual([]);
    });
  });
});
