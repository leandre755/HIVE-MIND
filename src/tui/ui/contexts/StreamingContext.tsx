import { createContext, useContext } from 'react';
import { StreamingState } from './UIStateContext.js';

export const StreamingContext = createContext<StreamingState | undefined>(undefined);

export const useStreamingContext = (): StreamingState => {
  const context = useContext(StreamingContext);
  if (context === undefined) {
    throw new Error('useStreamingContext must be used within a StreamingContextProvider');
  }
  return context;
};
