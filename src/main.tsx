import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/index.css";
import App from "./App";
import { applyTheme, savedTheme } from "./theme";

// Apply the saved theme before the first paint to avoid a flash.
applyTheme(savedTheme());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
