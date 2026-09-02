import { describe, it, expect, beforeEach } from '@jest/globals';
import { AnchorStateManager } from '../../../../services/anchor/AnchorStateManager.js';

describe('AnchorStateManager (SS-23: Hash-Anchored Edit)', () => {
  const filePath = '/virtual/workspace/code_service.ts';
  const sampleLines = [
    'import { helper } from "./helper";',
    '',
    'export function compute() {',
    '  const val = helper();',
    '  return val * 42;',
    '}',
  ];

  beforeEach(() => {
    AnchorStateManager.reset();
  });

  describe('Réconciliation Initiale', () => {
    it('génère des ancres uniques et stables pour toutes les lignes', () => {
      const anchors = AnchorStateManager.reconcile(filePath, sampleLines);
      expect(anchors).toHaveLength(sampleLines.length);

      const uniqueAnchors = new Set(anchors);
      expect(uniqueAnchors.size).toBe(anchors.length);
      anchors.forEach((a) => {
        expect(typeof a).toBe('string');
        expect(a.length).toBeGreaterThan(0);
      });
      expect(AnchorStateManager.isTracking(filePath)).toBe(true);
    });

    it('retourne les ancres en cache si le contenu des lignes est identique', () => {
      const anchors1 = AnchorStateManager.reconcile(filePath, sampleLines);
      const anchors2 = AnchorStateManager.reconcile(filePath, sampleLines);
      expect(anchors2).toEqual(anchors1);
    });
  });

  describe('Stabilité des Ancres à travers les Diff', () => {
    it('préserve les ancres des lignes inchangées lors d insertions et modifications', () => {
      const initialAnchors = AnchorStateManager.reconcile(filePath, sampleLines);

      const modifiedLines = [
        sampleLines[0], // inchangée
        sampleLines[1], // inchangée
        sampleLines[2], // inchangée
        '  console.log("Trace log");', // nouvelle ligne insérée
        '  const val = helper() + 1;', // ligne modifiée
        sampleLines[4], // inchangée
        sampleLines[5], // inchangée
      ];

      const updatedAnchors = AnchorStateManager.reconcile(filePath, modifiedLines);
      expect(updatedAnchors).toHaveLength(7);

      // Les lignes 0, 1, 2 doivent conserver exactement leurs ancres initiales
      expect(updatedAnchors[0]).toBe(initialAnchors[0]);
      expect(updatedAnchors[1]).toBe(initialAnchors[1]);
      expect(updatedAnchors[2]).toBe(initialAnchors[2]);
      // Les dernières lignes inchangées doivent également préserver leurs ancres
      expect(updatedAnchors[5]).toBe(initialAnchors[4]);
      expect(updatedAnchors[6]).toBe(initialAnchors[5]);

      const set = new Set(updatedAnchors);
      expect(set.size).toBe(7);
    });

    it('gère la suppression de lignes en préservant le contexte environnant', () => {
      const initialAnchors = AnchorStateManager.reconcile(filePath, sampleLines);

      // Suppression de la ligne d'indice 1 (ligne vide)
      const prunedLines = [
        sampleLines[0],
        sampleLines[2],
        sampleLines[3],
        sampleLines[4],
        sampleLines[5],
      ];
      const updatedAnchors = AnchorStateManager.reconcile(filePath, prunedLines);

      expect(updatedAnchors).toHaveLength(5);
      expect(updatedAnchors[0]).toBe(initialAnchors[0]);
      expect(updatedAnchors[1]).toBe(initialAnchors[2]);
      expect(updatedAnchors[2]).toBe(initialAnchors[3]);
      expect(updatedAnchors[3]).toBe(initialAnchors[4]);
      expect(updatedAnchors[4]).toBe(initialAnchors[5]);
    });
  });

  describe('Cas Limites & Isolation Multi-Tâches', () => {
    it('bascule en mode repli L1, L2 si le fichier dépasse MAX_TRACKED_LINES (50 000)', () => {
      const hugeLines = Array.from<string>({ length: 50001 }).fill('const x = 1;');
      const anchors = AnchorStateManager.reconcile(filePath, hugeLines);
      expect(anchors[0]).toBe('L1');
      expect(anchors[50000]).toBe('L50001');
      expect(anchors).toHaveLength(50001);
    });

    it('fournit getAnchors et clearState par fichier', () => {
      expect(AnchorStateManager.getAnchors(filePath)).toBeNull();
      const anchors = AnchorStateManager.reconcile(filePath, sampleLines);
      expect(AnchorStateManager.getAnchors(filePath)).toEqual(anchors);

      AnchorStateManager.clearState(filePath);
      expect(AnchorStateManager.isTracking(filePath)).toBe(false);
      expect(AnchorStateManager.getAnchors(filePath)).toBeNull();
    });

    it('isole strictement l état par taskId', () => {
      const taskA = 'task_agent_1';
      const taskB = 'task_agent_2';

      AnchorStateManager.reconcile(filePath, sampleLines, taskA);
      AnchorStateManager.reconcile(filePath, sampleLines, taskB);

      expect(AnchorStateManager.isTracking(filePath, taskA)).toBe(true);
      expect(AnchorStateManager.isTracking(filePath, taskB)).toBe(true);

      AnchorStateManager.reset(taskA);
      expect(AnchorStateManager.isTracking(filePath, taskA)).toBe(false);
      expect(AnchorStateManager.isTracking(filePath, taskB)).toBe(true);
    });
  });
});
