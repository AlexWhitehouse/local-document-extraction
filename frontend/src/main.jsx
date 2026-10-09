import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { ApplicationBootstrap } from "./ApplicationBootstrap";
import { startThemeSync } from "./lib/theme.js";

// Before the first render, so a light-theme user never sees the dark tokens.
startThemeSync();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ApplicationBootstrap />
  </React.StrictMode>
);
