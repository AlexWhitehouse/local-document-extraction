import { createContext } from "react";

// Below 1120px the context list is an off-canvas drawer. MainLayout provides this context
// (null when the page has no context list) so the PageHeader can render its toggle.
export const ContextDrawerContext = createContext(null);
