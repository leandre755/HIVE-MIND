import { providerRouter } from '../../../providers/index.js';
import { envResolver } from '../../../services/envResolver.js';

export interface ProviderFamilyStatus {
  id: string;
  name?: string;
  keyCount: number;
  modelCount: number;
}

export interface ProviderStatus {
  totalFamilies: number;
  activeFamilies: number;
  totalKeys: number;
  families: ProviderFamilyStatus[];
}

export function getProviderStatus(): ProviderStatus {
  const families = providerRouter.listFamilies().map((family) => ({
    id: family.id,
    name: family.name,
    keyCount: envResolver.getAvailableKeysForProvider(family.id).length,
    modelCount: family.models.length,
  }));
  const activeFamilies = families.filter((family) => family.keyCount > 0).length;
  const totalKeys = families.reduce((sum, family) => sum + family.keyCount, 0);
  return { totalFamilies: families.length, activeFamilies, totalKeys, families };
}
