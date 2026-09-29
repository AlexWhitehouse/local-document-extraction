import React from "react";
import { createRoot } from "react-dom/client";
import { ApplicationBootstrap } from "./ApplicationBootstrap";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ApplicationBootstrap />
  </React.StrictMode>
);
