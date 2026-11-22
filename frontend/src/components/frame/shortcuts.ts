import { createContext, useContext } from "react";
export const CompletionShortcut = createContext("x");
export const useCompletionShortcut = () => useContext(CompletionShortcut);
