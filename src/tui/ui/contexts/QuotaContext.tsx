import { createContext, useContext } from 'react';

export interface QuotaState {
  [key: string]: unknown;
}

export const QuotaContext = createContext<QuotaState | null>(null);

export const useQuotaState = () => {
  const context = useContext(QuotaContext);
  if (!context) {
    throw new Error('useQuotaState must be used within a QuotaProvider');
  }
  return context;
};
