import { createContext, useContext } from 'react';
import { StartupWarning } from './UIStateContext.js';

export interface AppState {
  version: string;
  startupWarnings: StartupWarning[];
}

export const AppContext = createContext<AppState | null>(null);

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
};
