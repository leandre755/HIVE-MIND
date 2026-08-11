import { createContext, useContext } from 'react';
import { HiveConfig } from '../../config/hiveConfig.js';

export const ConfigContext = createContext<HiveConfig | undefined>(undefined);

export const useConfig = () => {
  const context = useContext(ConfigContext);
  if (context === undefined) {
    throw new Error('useConfig must be used within a ConfigProvider');
  }
  return context;
};
