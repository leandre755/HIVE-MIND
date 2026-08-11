/**
 * Layer 1 Credential Provider
 *
 * Handles API key selection and rotation relying on envResolver and QuotaManager
 * while ensuring Layer 0 remains entirely stateless.
 */

import { envResolver } from '../../services/envResolver.js';
import { quotaManager } from '../../services/quotaManager.js';

export interface CredentialResolution {
  apiKey: string;
  keyIndex: number;
  provider: string;
}

export class CredentialProvider {
  private static instance: CredentialProvider | null = null;
  private rotationMap: Map<string, number> = new Map();

  public static getInstance(): CredentialProvider {
    if (!CredentialProvider.instance) {
      CredentialProvider.instance = new CredentialProvider();
    }
    return CredentialProvider.instance;
  }

  public static resetInstance(): void {
    CredentialProvider.instance = null;
  }

  public async getKey(
    providerName: string,
    modelId?: string,
  ): Promise<CredentialResolution | null> {
    if (!providerName) return null;

    // 1. Proactive healthy key selection via QuotaManager when modelId is supplied
    if (modelId) {
      try {
        const healthyKeyIndex = await quotaManager.getAvailableKeyForModel(modelId, providerName);
        if (healthyKeyIndex !== null) {
          const apiKey = envResolver.resolveProviderKey(providerName, healthyKeyIndex);
          if (apiKey) {
            return {
              apiKey,
              keyIndex: healthyKeyIndex,
              provider: providerName,
            };
          }
        }
      } catch {
        // Fallback to envResolver rotation if quotaManager fails
      }
    }

    // 2. Round-robin rotation over keys available in envResolver
    const availableIndices = envResolver.getAvailableKeysForProvider(providerName);
    if (!availableIndices || availableIndices.length === 0) {
      return null;
    }

    const lastPos = this.rotationMap.get(providerName) ?? -1;
    const nextPos = (lastPos + 1) % availableIndices.length;
    this.rotationMap.set(providerName, nextPos);

    const keyIndex = availableIndices.at(nextPos) ?? 1;
    const apiKey = envResolver.resolveProviderKey(providerName, keyIndex);

    if (!apiKey) {
      return null;
    }

    return {
      apiKey,
      keyIndex,
      provider: providerName,
    };
  }

  public async recordQuotaExceeded(
    modelId: string,
    keyIndex: number = 1,
    timeoutSeconds: number = 60,
  ): Promise<void> {
    if (!modelId) return;
    try {
      await quotaManager.recordQuotaExceeded(modelId, timeoutSeconds, keyIndex);
    } catch {
      // Ignore quotaManager errors safely
    }
  }
}

export const credentialProvider = CredentialProvider.getInstance();
