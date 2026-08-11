import { describe, it, expect } from '@jest/globals';
import { RuntimeSentinel } from '../../../services/runtime/RuntimeInfrastructure.js';
import { AgentBlueprint } from '../../../core/blueprint/AgentBlueprint.js';

describe('Constraint Manifold (RuntimeSentinel integration)', () => {
  const sentinel = new RuntimeSentinel();

  const mockBlueprint: AgentBlueprint = {
    metadata: {
      id: 'test_manifold',
      name: 'Manifold Agent',
      version: '1.0.0',
    },
    mindos: {
      drives: ['Execute order'],
    },
    action_space: {
      allowed_tools: ['read_file', 'list_directory', 'send_message'],
    },
    constraints: {
      read_only_fs: true,
      max_budget_usd: 0.5,
      max_iterations: 5,
    },
  };

  it('should block tools that are not in the blueprint whitelist', async () => {
    const result = await sentinel.evaluate(
      { function: { name: 'execute_bash_command', arguments: '{}' } },
      { authorityLevel: 'User', senderName: 'User' },
      [],
      mockBlueprint,
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('is not permitted by the agent blueprint constraints');
  });

  it('should allow tools that are in the blueprint whitelist and safe', async () => {
    const result = await sentinel.evaluate(
      { function: { name: 'read_file', arguments: '{"file": "test.ts"}' } },
      { authorityLevel: 'User', senderName: 'User' },
      [],
      mockBlueprint,
    );

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeNull();
  });

  it('should block write tools if read_only_fs is active, even if whitelisted', async () => {
    const writeBlueprint: AgentBlueprint = {
      ...mockBlueprint,
      action_space: {
        allowed_tools: ['read_file', 'edit_file'], // edit_file is whitelisted here
      },
      constraints: {
        ...mockBlueprint.constraints,
        read_only_fs: true, // But read-only FS is active
      },
    };

    const result = await sentinel.evaluate(
      { function: { name: 'edit_file', arguments: '{"file": "test.ts"}' } },
      { authorityLevel: 'User', senderName: 'User' },
      [],
      writeBlueprint,
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('FileSystem write operations');
  });

  it('should project action space correctly', () => {
    const rawTools = [
      { function: { name: 'read_file' } },
      { function: { name: 'edit_file' } },
      { function: { name: 'execute_bash_command' } },
    ];

    const projected = sentinel.projectActionSpace(rawTools, mockBlueprint);
    expect(projected).toHaveLength(1);
    expect(projected[0].function?.name).toBe('read_file');
  });

  it('should behave unchanged if no blueprint is provided', async () => {
    // Safe tool always allowed
    const result = await sentinel.evaluate(
      { function: { name: 'read_file', arguments: '{}' } },
      { authorityLevel: 'User', senderName: 'User' },
      [],
    );

    expect(result.allowed).toBe(true);
  });
});
