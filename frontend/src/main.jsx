import React from "react";
import { createRoot } from "react-dom/client";
import { ApplicationBootstrap } from "./ApplicationBootstrap";
import "./styles.css";

// Throwaway cost display study. The preview and its sample data are excluded from production.
const Root = import.meta.env.DEV && new URLSearchParams(window.location.search).get("prototype") === "costs"
  ? (await import("./features/workspaces/costPrototype/CostPrototype.jsx")).CostPrototype
  : ApplicationBootstrap;

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
