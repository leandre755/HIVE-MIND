import { createContext, useContext } from 'react';

export const ShellFocusContext = createContext<boolean>(true);

export const useShellFocusState = () => useContext(ShellFocusContext);
