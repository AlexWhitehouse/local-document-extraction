import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// Throwaway layout study. The preview and its sample data are excluded from production.
const Root = import.meta.env.DEV && new URLSearchParams(window.location.search).get("prototype") === "layouts"
  ? (await import("./features/layout/prototype/LayoutPrototype.jsx")).LayoutPrototype
  : App;

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
