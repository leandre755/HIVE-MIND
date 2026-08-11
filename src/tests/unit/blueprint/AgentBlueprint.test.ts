import { describe, it, expect } from '@jest/globals';
import { blueprintManager, AgenticFormatSchema } from '../../../core/blueprint/AgentBlueprint.js';

describe('AgentBlueprint & BlueprintManager', () => {
  it('should validate a correct blueprint structure', () => {
    const correctData = {
      metadata: {
        id: 'test_agent',
        name: 'Test Agent',
        version: '1.0.0',
      },
      mindos: {
        drives: ['Test drive 1', 'Test drive 2'],
      },
      action_space: {
        allowed_tools: ['tool_1', 'tool_2'],
      },
      constraints: {
        read_only_fs: true,
        max_budget_usd: 0.75,
        max_iterations: 8,
      },
    };

    const result = AgenticFormatSchema.safeParse(correctData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.constraints.max_iterations).toBe(8);
    }
  });

  it('should fall back to defaults when optional constraint fields are missing', () => {
    const minimalData = {
      metadata: {
        id: 'minimal_agent',
        name: 'Minimal Agent',
        version: '0.1',
      },
      mindos: {
        drives: [],
      },
      action_space: {
        allowed_tools: [],
      },
      constraints: {}, // Empty constraints to trigger defaults
    };

    const result = AgenticFormatSchema.safeParse(minimalData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.constraints.read_only_fs).toBe(false);
      expect(result.data.constraints.max_budget_usd).toBe(1.0);
      expect(result.data.constraints.max_iterations).toBe(10);
    }
  });

  it('should reject blueprint when required fields are missing', () => {
    const badData = {
      metadata: {
        id: 'bad_agent',
      },
      // Missing mindos, action_space
    };

    const result = AgenticFormatSchema.safeParse(badData);
    expect(result.success).toBe(false);
  });

  it('should load a blueprint from disk', () => {
    // hive_main.json is guaranteed to exist
    const blueprint = blueprintManager.loadBlueprint('hive_main');
    expect(blueprint.metadata.id).toBe('hive_main');
    expect(blueprint.mindos.drives.length).toBeGreaterThan(0);
    expect(blueprint.constraints.read_only_fs).toBe(false);
  });

  it('should throw when loading a non-existent blueprint from disk', () => {
    expect(() => {
      blueprintManager.loadBlueprint('ghost_blueprint_9999');
    }).toThrow();
  });

  it('should register and retrieve ephemeral blueprints from RAM', () => {
    const ephemeralData = {
      metadata: {
        id: 'ephemeral_agent_123',
        name: 'Ephemeral Agent',
        version: '1.0.0',
      },
      mindos: {
        drives: ['Obey order'],
      },
      action_space: {
        allowed_tools: ['tool_x'],
      },
      constraints: {
        read_only_fs: true,
        max_budget_usd: 0.1,
        max_iterations: 3,
      },
    };

    const registeredId = blueprintManager.registerEphemeral(ephemeralData);
    expect(registeredId).toBe('ephemeral_agent_123');

    // Verify it can be loaded
    const loaded = blueprintManager.loadBlueprint('ephemeral_agent_123');
    expect(loaded.metadata.name).toBe('Ephemeral Agent');
    expect(loaded.constraints.max_iterations).toBe(3);

    // Cleanup
    blueprintManager.cleanupEphemeral('ephemeral_agent_123');
    expect(() => {
      blueprintManager.loadBlueprint('ephemeral_agent_123');
    }).toThrow();
  });
});
